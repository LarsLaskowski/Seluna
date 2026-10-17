import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import worker from "./index";
import { version } from "../package.json";
import { body, headers } from "../test/fixtures/ping/form-delivery.json";
import { applyMigrations } from "../test/d1";
import { telegramDouble } from "../test/telegram";
import { FIXTURE_CODE, githubDouble, stateFor } from "../test/github";
import { keyFor, signingKeyFor } from "../test/keys";
import { writeSecret } from "./store/secrets";

// The throwaway SELUNA_SECRET of vitest.config.ts.
const SETUP_SECRET = "throwaway-test-secret-for-the-setup-login-0000";
const BOT_TOKEN = "123456789:AAH-throwaway_token0123456789abcdefghij";

/** The `name=value` pairs of the `Set-Cookie` headers of `response`, as a `Cookie` request header. */
function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .join("; ");
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("GET /health answers with the version from package.json", async () => {
  const response = await exports.default.fetch("https://example.com/health");

  const body: unknown = await response.json();

  expect(response.status, "status").toBe(200);
  expect(body, "body").toEqual({ status: "ok", version });
});

it("an unknown path answers 404 with an empty body", async () => {
  const response = await exports.default.fetch("https://example.com/anything");

  expect(response.status, "status").toBe(404);
  expect(await response.text(), "body").toBe("");
});

it("GET /setup answers the login page through the Worker", async () => {
  const response = await exports.default.fetch("https://example.com/setup");

  const page = await response.text();

  expect(response.status, "status").toBe(200);
  expect(page, "login form").toContain('action="/setup/login"');
  expect(page, "password input").toMatch(/type="password"/);
});

it("POST /webhook answers 202 for the real GitHub ping delivery with the configured secret", async () => {
  const response = await exports.default.fetch("https://example.com/webhook", {
    method: "POST",
    body,
    headers,
  });

  expect(response.status, "status").toBe(202);
  expect(await response.text(), "body").toBe("");
});

const FIXED_SCHEDULED_TIME = 1_700_000_000_000;

it.each(["*/10 * * * *", "17 5 * * *"])(
  "the scheduled handler completes without effect for the cron %s",
  async (cron) => {
    const handler: ExportedHandler<Env> = worker;
    const log = vi.spyOn(console, "log");
    const controller = createScheduledController({ cron, scheduledTime: FIXED_SCHEDULED_TIME });
    const ctx = createExecutionContext();

    expect(handler.scheduled, "scheduled handler").toBeTypeOf("function");
    const result = await handler.scheduled?.(controller, env, ctx);

    expect(result, "result").toBeUndefined();
    expect(log, "console.log calls").not.toHaveBeenCalled();
    await expect(waitOnExecutionContext(ctx), "pending work on the execution context").resolves.toBeUndefined();
  },
);

it("the Telegram step of /setup calls the Bot API through the global fetch of the Worker", async () => {
  await applyMigrations(env.DB);
  const telegram = telegramDouble();
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => telegram.fetch(new Request(input, init)));
  const workerEnv = { ...env, TELEGRAM_BOT_TOKEN: BOT_TOKEN };
  const ctx = createExecutionContext();
  const loginPage = await worker.fetch(new Request("https://example.com/setup"), workerEnv, ctx);
  const csrf = /name="csrf" value="([^"]*)"/.exec(await loginPage.text())?.[1] ?? "";
  const signedIn = await worker.fetch(
    new Request("https://example.com/setup/login", {
      method: "POST",
      headers: { cookie: cookieHeader(loginPage), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf, secret: SETUP_SECRET }).toString(),
    }),
    workerEnv,
    ctx,
  );

  const response = await worker.fetch(
    new Request("https://example.com/setup/telegram", { headers: { cookie: cookieHeader(signedIn) } }),
    workerEnv,
    ctx,
  );

  await waitOnExecutionContext(ctx);
  expect(signedIn.status, "login status").toBe(303);
  expect(response.status, "status").toBe(200);
  expect(telegram.methods(), "Bot API methods called").toEqual(["getUpdates"]);
});

/** Empties the credential tables now and when the test ends, so no stored credential leaks into another test. */
async function withEmptyCredentials(): Promise<void> {
  await applyMigrations(env.DB);
  const empty = async (): Promise<void> => {
    await env.DB.batch([env.DB.prepare("DELETE FROM secrets"), env.DB.prepare("DELETE FROM meta")]);
  };
  await empty();
  onTestFinished(empty);
}

it("the GitHub step of /setup calls the GitHub API through the global fetch of the Worker", async () => {
  const ctx = createExecutionContext();
  await withEmptyCredentials();
  const github = githubDouble();
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => github.fetch(new Request(input, init)));
  const workerEnv = { ...env, GITHUB_WEBHOOK_SECRET: "" };
  const loginPage = await worker.fetch(new Request("https://example.com/setup"), workerEnv, ctx);
  const csrf = /name="csrf" value="([^"]*)"/.exec(await loginPage.text())?.[1] ?? "";
  const signedIn = await worker.fetch(
    new Request("https://example.com/setup/login", {
      method: "POST",
      headers: { cookie: cookieHeader(loginPage), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf, secret: SETUP_SECRET }).toString(),
    }),
    workerEnv,
    ctx,
  );
  const cookies = cookieHeader(signedIn);
  const session = /seluna_session=([^;\s]+)/.exec(cookies)?.[1] ?? "";
  const state = await stateFor(
    await signingKeyFor(SETUP_SECRET, "setup-github"),
    session,
    { type: "personal", account: "github" },
    new Date(),
  );

  const response = await worker.fetch(
    new Request("https://example.com/setup/github/callback", {
      method: "POST",
      headers: { cookie: cookies, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: FIXTURE_CODE, state }).toString(),
    }),
    workerEnv,
    ctx,
  );

  expect(signedIn.status, "login status").toBe(303);
  expect(session, "session token").not.toBe("");
  expect(response.status, "status").toBe(200);
  expect(
    github.requests.map((request) => request.code),
    "converted codes",
  ).toEqual([FIXTURE_CODE]);
});

it("POST /webhook uses the webhook secret stored in D1 through the Worker", async () => {
  const ctx = createExecutionContext();
  await withEmptyCredentials();
  const stored = await writeSecret(env.DB, await keyFor(SETUP_SECRET), "github_webhook_secret", "my-secret");
  const workerEnv = { ...env, GITHUB_WEBHOOK_SECRET: "" };

  const response = await worker.fetch(
    new Request("https://example.com/webhook", { method: "POST", body, headers }),
    workerEnv,
    ctx,
  );

  expect(stored, "storing the webhook secret").toEqual({ kind: "ok" });
  expect(response.status, "status").toBe(202);
});
