import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import worker from "./index";
import type { Rule } from "./rules/rule";
import { version } from "../package.json";
import { body, headers } from "../test/fixtures/ping/form-delivery.json";
import { applyMigrations } from "../test/d1";
import { telegramDouble } from "../test/telegram";
import { FIXTURE_CODE, githubDouble, stateFor } from "../test/github";
import { keyFor, signingKeyFor } from "../test/keys";
import { writeSecret } from "./store/secrets";

const { WIRING_ZEN } = vi.hoisted(() => ({ WIRING_ZEN: "Seluna wiring test" }));

// The registry holds no rule yet: this one reports only the `ping` whose zen is WIRING_ZEN (never the real ping), so
// the wiring of the Worker (waitUntil, the Telegram fetch) is tested end to end.
vi.mock("./rules/registry", () => {
  const rule: Rule = {
    id: "pull_request_opened",
    evaluate: (event, payload) =>
      event === "ping" && payload.zen === WIRING_ZEN
        ? {
            title: "Wiring",
            repository: "octo/repo",
            number: 1,
            subject: "Subject",
            context: "Context",
            url: "https://github.com/octo/repo/pull/1",
          }
        : undefined,
  };
  return { RULES: [rule] };
});

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

/** Empties the tables of the webhook processing now and when the test ends, so a delivery id is new in every test. */
async function withEmptyDeliveries(): Promise<void> {
  await applyMigrations(env.DB);
  const empty = async (): Promise<void> => {
    await env.DB.batch([env.DB.prepare("DELETE FROM deliveries"), env.DB.prepare("DELETE FROM outbox")]);
  };
  await empty();
  onTestFinished(empty);
}

it("POST /webhook through the Worker answers 202 to the real ping delivery and 200 to its redelivery", async () => {
  await withEmptyDeliveries();

  const first = await exports.default.fetch("https://example.com/webhook", { method: "POST", body, headers });
  const second = await exports.default.fetch("https://example.com/webhook", { method: "POST", body, headers });

  expect(first.status, "status of the delivery").toBe(202);
  expect(await first.text(), "body of the delivery").toBe("");
  expect(second.status, "status of the redelivery").toBe(200);
  expect(await second.text(), "body of the redelivery").toBe("");
});

/** `sha256=<hex>` of the HMAC-SHA256 of `text` under the throwaway secret of the real delivery. */
async function signatureOf(text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("my-secret"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
  return `sha256=${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

it("POST /webhook through the Worker sends the message of a matching rule to Telegram after the response", async () => {
  await withEmptyDeliveries();
  const telegram = telegramDouble();
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => telegram.fetch(new Request(input, init)));
  const workerEnv = { ...env, TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_CHAT_ID: "5001001" };
  const ctx = createExecutionContext();
  const text = JSON.stringify({ zen: WIRING_ZEN, repository: { full_name: "octo/repo" } });
  const request = new Request("https://example.com/webhook", {
    method: "POST",
    body: text,
    headers: {
      "content-type": "application/json",
      "x-github-event": "ping",
      "x-github-delivery": "wiring-test-1",
      "x-hub-signature-256": await signatureOf(text),
    },
  });

  const response = await worker.fetch(request, workerEnv, ctx);
  await waitOnExecutionContext(ctx);

  expect(response.status, "status").toBe(202);
  expect(telegram.methods(), "Bot API methods called").toEqual(["sendMessage"]);
  expect(await env.DB.prepare("SELECT status, attempts FROM outbox").first(), "outbox row").toEqual({
    status: "sent",
    attempts: 1,
  });
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
  await withEmptyDeliveries();
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
