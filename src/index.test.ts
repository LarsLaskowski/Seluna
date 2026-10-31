import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import type { MockInstance } from "vitest";
import worker from "./index";
import type { Rule } from "./rules/rule";
import { version } from "../package.json";
import { body, headers } from "../test/fixtures/ping/form-delivery.json";
import { applyMigrations } from "../test/d1";
import { telegramDouble } from "../test/telegram";
import {
  FIXTURE_CODE,
  githubApiDouble,
  githubDouble,
  jsonAnswer as githubAnswer,
  latestReleaseBody,
  stateFor,
} from "../test/github";
import { keyFor, signingKeyFor } from "../test/keys";
import { writeSecret } from "./store/secrets";

const { WIRING_ZEN, WIRING_DRAFT_ZEN } = vi.hoisted(() => ({
  WIRING_ZEN: "Seluna wiring test",
  WIRING_DRAFT_ZEN: "Seluna draft wiring test",
}));

// The mock replaces the real rules: this one reports only the `ping` whose zen is WIRING_ZEN (never the real ping), so
// a ping can drive the wiring of the Worker (waitUntil, the Telegram fetch) end to end.
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
  // A second rule whose notification carries a draft check, to drive the lookup wiring of the Worker.
  const draftRule: Rule = {
    id: "ci_failed_pull_request",
    evaluate: (event, payload) =>
      event === "ping" && payload.zen === WIRING_DRAFT_ZEN
        ? {
            title: "Wiring draft",
            repository: "octo/repo",
            number: 2,
            subject: "Subject",
            context: "Context",
            url: "https://github.com/octo/repo/pull/2",
            draftCheck: {
              pullRequest: { owner: "octo", repo: "repo", number: 2 },
              titleWhenUnknown: "Wiring draft (draft status unknown)",
            },
          }
        : undefined,
  };
  return { RULES: [rule, draftRule] };
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

it("POST /webhook through the Worker answers 202 to the real ping delivery and again to its redelivery, storing nothing", async () => {
  await withEmptyDeliveries();

  const first = await exports.default.fetch("https://example.com/webhook", { method: "POST", body, headers });
  const second = await exports.default.fetch("https://example.com/webhook", { method: "POST", body, headers });

  expect(first.status, "status of the delivery").toBe(202);
  expect(await first.text(), "body of the delivery").toBe("");
  expect(second.status, "status of the redelivery").toBe(202);
  expect(await second.text(), "body of the redelivery").toBe("");
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM deliveries").first("n"), "deliveries rows").toBe(0);
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

it("POST /webhook through the Worker answers 200 to the redelivery of a recorded delivery", async () => {
  await withEmptyDeliveries();
  const telegram = telegramDouble();
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => telegram.fetch(new Request(input, init)));
  const workerEnv = { ...env, TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_CHAT_ID: "5001001" };
  const text = JSON.stringify({ zen: WIRING_ZEN, repository: { full_name: "octo/repo" } });
  const send = async (): Promise<Response> => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request("https://example.com/webhook", {
        method: "POST",
        body: text,
        headers: {
          "content-type": "application/json",
          "x-github-event": "ping",
          "x-github-delivery": "wiring-test-redelivery",
          "x-hub-signature-256": await signatureOf(text),
        },
      }),
      workerEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return response;
  };

  const first = await send();
  const second = await send();

  expect([first.status, second.status], "statuses").toEqual([202, 200]);
  expect(telegram.methods(), "Bot API methods called").toEqual(["sendMessage"]);
});

it("the Worker resolves a draft check through the GitHub API client and, without a GitHub App, sends the draft-status-unknown title", async () => {
  await withEmptyCredentials();
  await withEmptyDeliveries();
  const telegram = telegramDouble();
  const outbound = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input, init) => telegram.fetch(new Request(input, init)));
  const workerEnv = { ...env, TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_CHAT_ID: "5001001" };
  const ctx = createExecutionContext();
  const text = JSON.stringify({
    zen: WIRING_DRAFT_ZEN,
    repository: { full_name: "octo/repo" },
    installation: { id: 3000 },
  });
  const request = new Request("https://example.com/webhook", {
    method: "POST",
    body: text,
    headers: {
      "content-type": "application/json",
      "x-github-event": "ping",
      "x-github-delivery": "wiring-test-draft",
      "x-hub-signature-256": await signatureOf(text),
    },
  });

  const response = await worker.fetch(request, workerEnv, ctx);
  await waitOnExecutionContext(ctx);

  expect(response.status, "status").toBe(202);
  expect(telegram.methods(), "Bot API methods called").toEqual(["sendMessage"]);
  expect(outbound, "outbound requests").toHaveBeenCalledTimes(1);
  expect(await env.DB.prepare("SELECT text, status FROM outbox").first(), "outbox row").toEqual({
    text: '{"title":"Wiring draft (draft status unknown)","repository":"octo/repo","number":2,"subject":"Subject","context":"Context"}',
    status: "sent",
  });
});

const FIXED_SCHEDULED_TIME = 1_700_000_000_000;

/** Routes the global `fetch` of the Worker to the doubles of Telegram and the GitHub API by host. */
function routeGlobalFetch(
  telegram: ReturnType<typeof telegramDouble>,
  github: ReturnType<typeof githubApiDouble>,
): MockInstance<typeof fetch> {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const request = new Request(input, init);
    return new URL(request.url).hostname === "api.telegram.org" ? telegram.fetch(request) : github.fetch(request);
  });
}

async function runScheduledCron(cron: string, workerEnv: Env): Promise<void> {
  const handler: ExportedHandler<Env> = worker;
  const controller = createScheduledController({ cron, scheduledTime: FIXED_SCHEDULED_TIME });
  const ctx = createExecutionContext();

  expect(handler.scheduled, "scheduled handler").toBeTypeOf("function");
  const result = await handler.scheduled?.(controller, workerEnv, ctx);

  expect(result, "result").toBeUndefined();
  await waitOnExecutionContext(ctx);
}

it("the scheduled handler for */10 * * * * sends a due outbox row through the global fetch and calls no GitHub API", async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([env.DB.prepare("DELETE FROM outbox"), env.DB.prepare("DELETE FROM settings")]);
  onTestFinished(async () => {
    await env.DB.prepare("DELETE FROM outbox").run();
  });
  const written = Date.now() - 2 * 60_000;
  await env.DB.prepare("INSERT INTO outbox (text, silent, created_at) VALUES ('<b>T</b> · o/r #7', 0, ?1)")
    .bind(written)
    .run();
  const telegram = telegramDouble();
  const github = githubApiDouble({});
  routeGlobalFetch(telegram, github);

  const workerEnv = { ...env, TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_CHAT_ID: "5001001" };

  await runScheduledCron("*/10 * * * *", workerEnv);

  expect(telegram.methods(), "Bot API methods called").toEqual(["sendMessage"]);
  expect(github.requests.length, "number of GitHub requests").toBe(0);
  expect(await env.DB.prepare("SELECT status, attempts FROM outbox").first(), "outbox row").toEqual({
    status: "sent",
    attempts: 1,
  });
});

it("the scheduled handler for 17 5 * * * asks GitHub for the latest release through the global fetch without credentials", async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM outbox"),
    env.DB.prepare("DELETE FROM settings"),
    env.DB.prepare("DELETE FROM meta"),
  ]);
  onTestFinished(async () => {
    await env.DB.batch([env.DB.prepare("DELETE FROM outbox"), env.DB.prepare("DELETE FROM meta")]);
  });
  const telegram = telegramDouble();
  const github = githubApiDouble({
    latestRelease: githubAnswer(200, latestReleaseBody({ tag_name: "v999.0.0" })),
  });
  routeGlobalFetch(telegram, github);

  const workerEnv = { ...env, TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_CHAT_ID: "5001001" };

  await runScheduledCron("17 5 * * *", workerEnv);

  expect(
    github.requests.map((request) => request.route),
    "GitHub routes",
  ).toEqual(["latestRelease"]);
  expect(github.requests[0]?.authorization, "Authorization header").toBeNull();
  expect(telegram.methods(), "Bot API methods called").toEqual(["sendMessage"]);
});

it("the scheduled handler logs one unknown-schedule entry for another cron and makes no request", async () => {
  await applyMigrations(env.DB);
  const log = vi.spyOn(console, "log");
  const outbound = vi.spyOn(globalThis, "fetch");

  await runScheduledCron("0 * * * *", env);

  expect(log.mock.calls, "console.log calls").toEqual([[{ job: "schedule", result: "unknown" }]]);
  expect(outbound, "outbound requests").not.toHaveBeenCalled();
});

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
