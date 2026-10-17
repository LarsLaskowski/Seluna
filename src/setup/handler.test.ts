import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_BODY_BYTES } from "../body";
import { LOGIN_ATTEMPTS_META_KEY, LOGIN_LOCK_MS } from "../store/login-attempts";
import { readSecret, writeSecret } from "../store/secrets";
import { readNotificationSettings, writeNotificationSettings } from "../store/settings";
import { DEFAULT_SETTINGS } from "../settings";
import type { NotificationSettings } from "../settings";
import { CSRF_COOKIE, csrfTokenFor, sessionCsrfTokenFor } from "./csrf";
import { createChatProof } from "./chat-proof";
import { verifyGitHubState } from "./github-state";
import { handleSetup, isSetupPath } from "./handler";
import type { SetupDeps } from "./handler";
import { contentSecurityPolicy, escapeHtml } from "./pages";
import { createSessionToken, SESSION_COOKIE, SESSION_LIFETIME_MS } from "./session";
import { RESET_PATH, SETTINGS_PATH } from "./settings-form";
import { TEXTS } from "./texts";
import type { Notice } from "./texts";
import { applyMigrations, migrationTestDb, unusedDb } from "../../test/d1";
import {
  conversionAnswer,
  conversionOwnedBy,
  expectedManifestJson,
  FIXTURE_CLIENT_SECRET,
  FIXTURE_CODE,
  FIXTURE_PKCS8,
  FIXTURE_WEBHOOK_SECRET,
  FIXTURES as GITHUB_FIXTURES,
  githubDouble,
  jsonAnswer as githubJsonAnswer,
  REJECTED as GITHUB_REJECTED,
  stateFor,
} from "../../test/github";
import type { GitHubAnswer, GitHubDouble } from "../../test/github";
import { keyFor, signingKeyFor, withFirstCharacterChanged } from "../../test/keys";
import { FIXTURES, jsonAnswer, REJECTED, telegramDouble, updatesAnswer } from "../../test/telegram";
import type { TelegramAnswer, TelegramDouble } from "../../test/telegram";

const ORIGIN = "https://example.com";
const SECRET = "throwaway-setup-secret-0123456789abcdef";
const OTHER_SECRET = "another-throwaway-secret-fedcba9876543210";
const NOW = new Date(1_700_000_000_000);
const CSRF_VALUE = "A".repeat(43);
const OTHER_CSRF_VALUE = "B".repeat(43);
const SESSION_COOKIE_ATTRIBUTES = "Path=/setup; HttpOnly; Secure; SameSite=Strict";

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.prepare("DELETE FROM meta WHERE key = ?1").bind(LOGIN_ATTEMPTS_META_KEY).run();
  await env.DB.prepare("DELETE FROM settings").run();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM secrets"),
    env.DB.prepare("DELETE FROM token_cache"),
    env.DB.prepare("DELETE FROM meta WHERE key IN ('key_check', 'last_delivery', 'github_app_slug')"),
  ]);
});

/** Setup dependencies with a usable `SELUNA_SECRET`, the real database and a clock fixed at `milliseconds`. */
function depsAt(milliseconds = NOW.getTime(), overrides: Partial<SetupDeps> = {}): SetupDeps {
  return {
    env: { SELUNA_SECRET: SECRET },
    db: env.DB,
    now: () => new Date(milliseconds),
    fetch: () => Promise.reject(new Error("unexpected Telegram call")),
    githubFetch: () => Promise.reject(new Error("unexpected GitHub call")),
    version: "0.0.0-test",
    ...overrides,
  };
}

interface RequestInitLike {
  readonly method?: string;
  readonly cookies?: readonly string[];
  readonly headers?: Record<string, string>;
  readonly body?: string | ReadableStream<Uint8Array>;
}

/** Calls `handleSetup` with a request for `path` (which may carry a query). */
function call(path: string, init: RequestInitLike = {}, deps: SetupDeps = depsAt()): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.cookies !== undefined && init.cookies.length > 0) {
    headers.set("cookie", init.cookies.join("; "));
  }
  if (typeof init.body === "string") {
    headers.set("content-type", "application/x-www-form-urlencoded");
  }
  const request = new Request(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers, body: init.body });
  return handleSetup(request, new URL(request.url).pathname, deps);
}

type FormFields = readonly (readonly [string, string])[];

/** An `application/x-www-form-urlencoded` body of the fields, in order (a name may repeat). */
function form(fields: FormFields): string {
  return new URLSearchParams(fields.map(([name, value]) => [name, value])).toString();
}

async function sessionToken(createdAt: Date = NOW, secret: string = SECRET): Promise<string> {
  return createSessionToken(await signingKeyFor(secret, "setup-session"), createdAt);
}

async function sessionCookie(createdAt: Date = NOW, secret: string = SECRET): Promise<string> {
  return `${SESSION_COOKIE}=${await sessionToken(createdAt, secret)}`;
}

const csrfCookie = (value: string = CSRF_VALUE): string => `${CSRF_COOKIE}=${value}`;

async function csrfToken(cookieValue: string = CSRF_VALUE, secret: string = SECRET): Promise<string> {
  return csrfTokenFor(await signingKeyFor(secret, "setup-csrf"), cookieValue);
}

/** The token of a signed-in form: bound to the session token `session` and the cookie value. */
async function sessionCsrfToken(
  session: string,
  cookieValue: string = CSRF_VALUE,
  secret: string = SECRET,
): Promise<string> {
  return sessionCsrfTokenFor(await signingKeyFor(secret, "setup-csrf"), session, cookieValue);
}

/** The value of the hidden `csrf` input of `html`, or an empty text. */
function renderedToken(html: string): string {
  const input = /<input\b(?=[^>]*type="hidden")(?=[^>]*name="csrf")[^>]*>/.exec(html)?.[0] ?? "";
  return /value="([^"]*)"/.exec(input)?.[1] ?? "";
}

/** A login submission with a valid CSRF token and the given `secret` field. */
async function loginInit(secretField: string = SECRET): Promise<RequestInitLike> {
  return {
    method: "POST",
    cookies: [csrfCookie()],
    body: form([
      ["csrf", await csrfToken()],
      ["secret", secretField],
    ]),
  };
}

async function login(secretField: string = SECRET, deps: SetupDeps = depsAt()): Promise<Response> {
  return call("/setup/login", await loginInit(secretField), deps);
}

/** The statuses of `count` logins with a wrong secret, one after the other. */
async function wrongLogins(count: number, deps: SetupDeps = depsAt()): Promise<number[]> {
  const statuses: number[] = [];
  for (let index = 0; index < count; index++) {
    statuses.push((await login("wrong", deps)).status);
  }
  return statuses;
}

/** The value of the `login_attempts` row, or `undefined` when there is none. */
async function storedAttempts(): Promise<unknown> {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = ?1").bind(LOGIN_ATTEMPTS_META_KEY).first();
  return row?.value;
}

function noticeText(notice: Notice, language: "en" | "de" = "en"): string {
  return escapeHtml(TEXTS[language].notices[notice]);
}

function expectLoginPage(html: string): void {
  expect(html, "login form action").toContain('action="/setup/login"');
  expect(html, "login form method").toMatch(/method="post"/i);
  expect(html, "password input").toMatch(/<input\b(?=[^>]*type="password")(?=[^>]*name="secret")[^>]*>/);
  expect(html, "hidden csrf input").toMatch(/<input\b(?=[^>]*type="hidden")(?=[^>]*name="csrf")[^>]*>/);
}

function expectStartPage(html: string): void {
  expect(html, "sign-out form action").toContain('action="/setup/logout"');
  expect(html, "login form action").not.toContain('action="/setup/login"');
}

/** The `Set-Cookie` values of `response` that set or clear the cookie `name`. */
function setCookiesOf(response: Response, name: string): string[] {
  return response.headers.getSetCookie().filter((cookie) => cookie.startsWith(`${name}=`));
}

describe("isSetupPath", () => {
  it.each([
    { path: "/setup", expected: true },
    { path: "/setup/", expected: true },
    { path: "/setup/x", expected: true },
    { path: "/setupx", expected: false },
    { path: "/SETUP", expected: false },
    { path: "/setup%2F", expected: false },
    { path: "/", expected: false },
    { path: "/set", expected: false },
  ])("isSetupPath returns $expected for $path", ({ path, expected }) => {
    const result = isSetupPath(path);

    expect(result, "result").toBe(expected);
  });
});

describe("handleSetup without a session", () => {
  it.each([
    { method: "GET", path: "/setup" },
    { method: "GET", path: "/setup/" },
    { method: "GET", path: "/setup/anything" },
    { method: "GET", path: "/setup/login" },
    { method: "POST", path: "/setup/logout" },
    { method: "POST", path: "/setup/anything" },
    { method: "PUT", path: "/setup" },
  ])("handleSetup answers $method $path without a session with 200 and the login page", async ({ method, path }) => {
    const response = await call(path, { method });

    expect(response.status, "status").toBe(200);
    expectLoginPage(await response.text());
  });

  it.each([
    {
      name: "expired",
      cookie: () => sessionCookie(new Date(NOW.getTime() - SESSION_LIFETIME_MS)),
    },
    {
      name: "altered in its MAC",
      cookie: async () => {
        const [version = "", expires = "", mac = ""] = (await sessionToken()).split(".");
        return `${SESSION_COOKIE}=${[version, expires, withFirstCharacterChanged(mac)].join(".")}`;
      },
    },
    { name: "signed under another SELUNA_SECRET", cookie: () => sessionCookie(NOW, OTHER_SECRET) },
    { name: "quoted", cookie: async () => `${SESSION_COOKIE}="${await sessionToken()}"` },
    {
      name: "valid for more than 12 hours",
      cookie: () => sessionCookie(new Date(NOW.getTime() + 1)),
    },
  ])("handleSetup shows the login page for a session cookie that is $name", async ({ cookie }) => {
    const response = await call("/setup", { cookies: [await cookie()] });

    expect(response.status, "status").toBe(200);
    expectLoginPage(await response.text());
  });

  it("handleSetup shows the login page when the only valid seluna_session is the fifth value", async () => {
    const cookies = ["a", "b", "c", "d"].map((value) => `${SESSION_COOKIE}=${value}`);

    const response = await call("/setup", { cookies: [...cookies, await sessionCookie()] });

    expect(response.status, "status").toBe(200);
    expectLoginPage(await response.text());
  });

  it("handleSetup shows the start page when the valid seluna_session is the fourth value", async () => {
    const cookies = ["a", "b", "c"].map((value) => `${SESSION_COOKIE}=${value}`);

    const response = await call("/setup", { cookies: [...cookies, await sessionCookie()] });

    expect(response.status, "status").toBe(200);
    expectStartPage(await response.text());
  });
});

describe("handleSetup login lock", () => {
  it("handleSetup rejects the sixth login within 15 minutes with 429 even with the correct secret", async () => {
    await wrongLogins(5);

    const response = await login(SECRET);

    expect(response.status, "status").toBe(429);
    expect(await response.text(), "body").toContain(noticeText("locked"));
    expect(setCookiesOf(response, SESSION_COOKIE), "session cookies").toEqual([]);
  });

  it("handleSetup accepts the correct secret 15 minutes after the fifth failed attempt", async () => {
    await wrongLogins(5);

    const response = await login(SECRET, depsAt(NOW.getTime() + LOGIN_LOCK_MS));

    expect(response.status, "status").toBe(303);
  });

  it("handleSetup resets the count after a successful login", async () => {
    await wrongLogins(4);
    await login(SECRET);

    const statuses = await wrongLogins(5);

    expect(statuses, "statuses of five wrong logins").toEqual([403, 403, 403, 403, 403]);
  });
});

interface Tokens {
  readonly valid: string;
  readonly ofOtherCookieValue: string;
  readonly ofOtherSecret: string;
}

async function tokens(): Promise<Tokens> {
  return {
    valid: await csrfToken(),
    ofOtherCookieValue: await csrfToken(OTHER_CSRF_VALUE),
    ofOtherSecret: await csrfToken(CSRF_VALUE, OTHER_SECRET),
  };
}

function csrfLogin(fields: FormFields, cookies: readonly string[] = [csrfCookie()]): RequestInitLike {
  return { method: "POST", cookies, body: form(fields) };
}

describe("handleSetup CSRF", () => {
  it.each([
    { name: "no csrf field", init: () => csrfLogin([["secret", SECRET]]) },
    {
      name: "an empty csrf field",
      init: () =>
        csrfLogin([
          ["csrf", ""],
          ["secret", SECRET],
        ]),
    },
    {
      name: "a wrong token",
      init: (t: Tokens) =>
        csrfLogin([
          ["csrf", withFirstCharacterChanged(t.valid)],
          ["secret", SECRET],
        ]),
    },
    {
      name: "the token of another cookie value",
      init: (t: Tokens) =>
        csrfLogin([
          ["csrf", t.ofOtherCookieValue],
          ["secret", SECRET],
        ]),
    },
    {
      name: "no seluna_csrf cookie",
      init: (t: Tokens) =>
        csrfLogin(
          [
            ["csrf", t.valid],
            ["secret", SECRET],
          ],
          [],
        ),
    },
    {
      name: "two csrf fields",
      init: (t: Tokens) =>
        csrfLogin([
          ["csrf", t.valid],
          ["csrf", t.valid],
          ["secret", SECRET],
        ]),
    },
    {
      name: "a token made under another SELUNA_SECRET",
      init: (t: Tokens) =>
        csrfLogin([
          ["csrf", t.ofOtherSecret],
          ["secret", SECRET],
        ]),
    },
  ])("handleSetup rejects a login with $name with 403 and does not count it", async ({ init }) => {
    const response = await call("/setup/login", init(await tokens()));

    expect(response.status, "status").toBe(403);
    const html = await response.text();
    expectLoginPage(html);
    expect(html, "form expired notice").toContain(noticeText("form-expired"));
    expect(setCookiesOf(response, SESSION_COOKIE), "session cookies").toEqual([]);
    expect(await storedAttempts(), "stored attempts").toBeUndefined();
  });

  it.each([
    { name: "no csrf field", fields: (): Promise<FormFields> => Promise.resolve([]) },
    {
      name: "a wrong token",
      fields: async (): Promise<FormFields> => [["csrf", withFirstCharacterChanged(await csrfToken())]],
    },
  ])("handleSetup rejects a logout with $name with 403 and keeps the session", async ({ fields }) => {
    const response = await call("/setup/logout", {
      method: "POST",
      cookies: [await sessionCookie(), csrfCookie()],
      body: form(await fields()),
    });

    expect(response.status, "status").toBe(403);
    const html = await response.text();
    expectStartPage(html);
    expect(html, "form expired notice").toContain(noticeText("form-expired"));
    expect(setCookiesOf(response, SESSION_COOKIE), "session cookies").toEqual([]);
  });

  it.each([
    {
      name: "the unbound login-form token of the request's cookie value",
      cookies: async () => [await sessionCookie(), csrfCookie()],
      token: () => csrfToken(),
    },
    {
      name: "bound to another valid session",
      cookies: async () => [await sessionCookie(), csrfCookie()],
      token: async () => sessionCsrfToken(await sessionToken(new Date(NOW.getTime() - 3_600_000))),
    },
    {
      name: "the unbound token of a second, tossed seluna_csrf value",
      cookies: async () => [await sessionCookie(), csrfCookie(), csrfCookie(OTHER_CSRF_VALUE)],
      token: () => csrfToken(OTHER_CSRF_VALUE),
    },
  ])("handleSetup rejects a logout whose token is $name with 403 and keeps the session", async ({ cookies, token }) => {
    const response = await call("/setup/logout", {
      method: "POST",
      cookies: await cookies(),
      body: form([["csrf", await token()]]),
    });

    expect(response.status, "status").toBe(403);
    const html = await response.text();
    expectStartPage(html);
    expect(html, "form expired notice").toContain(noticeText("form-expired"));
    expect(setCookiesOf(response, SESSION_COOKIE), "session cookies").toEqual([]);
  });

  it("handleSetup rejects a login with a session-bound token with 403", async () => {
    const response = await call("/setup/login", {
      method: "POST",
      cookies: [csrfCookie()],
      body: form([
        ["csrf", await sessionCsrfToken(await sessionToken())],
        ["secret", SECRET],
      ]),
    });

    expect(response.status, "status").toBe(403);
    const html = await response.text();
    expectLoginPage(html);
    expect(html, "form expired notice").toContain(noticeText("form-expired"));
    expect(setCookiesOf(response, SESSION_COOKIE), "session cookies").toEqual([]);
  });

  it("handleSetup accepts the unbound login token while a session cookie is present", async () => {
    const init = await loginInit();

    const response = await call("/setup/login", { ...init, cookies: [await sessionCookie(), csrfCookie()] });

    expect(response.status, "status").toBe(303);
    expect(response.headers.get("Location"), "Location").toBe("/setup");
  });

  it("handleSetup sets a new seluna_csrf cookie on the login page when the request has none", async () => {
    const response = await call("/setup");

    const cookies = setCookiesOf(response, CSRF_COOKIE);
    const match = /^seluna_csrf=([A-Za-z0-9_-]{43}); Path=\/setup; HttpOnly; Secure; SameSite=Strict$/.exec(
      cookies[0] ?? "",
    );
    expect(cookies.length, "number of seluna_csrf cookies").toBe(1);
    expect(match, "form of the seluna_csrf cookie (no Max-Age)").not.toBeNull();
    expect(await response.text(), "page").toContain(`value="${await csrfToken(match?.[1] ?? "")}"`);
  });

  it("handleSetup renders the token of the request's seluna_csrf cookie and sets no new one", async () => {
    const response = await call("/setup", { cookies: [csrfCookie()] });

    expect(await response.text(), "page").toContain(`value="${await csrfToken()}"`);
    expect(setCookiesOf(response, CSRF_COOKIE), "seluna_csrf cookies").toEqual([]);
  });
});

describe("handleSetup login", () => {
  it("handleSetup answers the correct secret with 303 to /setup and the session cookie", async () => {
    const response = await login(SECRET);

    expect(response.status, "status").toBe(303);
    expect(response.headers.get("Location"), "Location").toBe("/setup");
    expect(response.headers.getSetCookie(), "Set-Cookie").toContain(
      `${SESSION_COOKIE}=${await sessionToken()}; Max-Age=43200; ${SESSION_COOKIE_ATTRIBUTES}`,
    );
  });

  it("handleSetup shows the start page for GET /setup with the session from the login", async () => {
    const loginResponse = await login(SECRET);
    const cookie = /^(seluna_session=[^;]+);/.exec(setCookiesOf(loginResponse, SESSION_COOKIE)[0] ?? "")?.[1] ?? "";

    const response = await call("/setup", { cookies: [cookie] });

    expect(response.status, "status").toBe(200);
    expectStartPage(await response.text());
  });

  it.each([
    {
      name: "wrong",
      fields: (token: string): FormFields => [
        ["csrf", token],
        ["secret", "wrong"],
      ],
    },
    { name: "missing", fields: (token: string): FormFields => [["csrf", token]] },
    {
      name: "repeated",
      fields: (token: string): FormFields => [
        ["csrf", token],
        ["secret", SECRET],
        ["secret", SECRET],
      ],
    },
  ])("handleSetup answers a $name secret with 403 and the wrong-secret notice", async ({ fields }) => {
    const response = await call("/setup/login", {
      method: "POST",
      cookies: [csrfCookie()],
      body: form(fields(await csrfToken())),
    });

    expect(response.status, "status").toBe(403);
    const html = await response.text();
    expectLoginPage(html);
    expect(html, "wrong secret notice").toContain(noticeText("wrong-secret"));
    expect(setCookiesOf(response, SESSION_COOKIE), "session cookies").toEqual([]);
  });
});

describe("handleSetup sign-out and the signed-in branch", () => {
  it("handleSetup signs out with a valid CSRF token: 303 to /setup and an expired session cookie", async () => {
    const response = await call("/setup/logout", {
      method: "POST",
      cookies: [await sessionCookie(), csrfCookie()],
      body: form([["csrf", await sessionCsrfToken(await sessionToken())]]),
    });

    expect(response.status, "status").toBe(303);
    expect(response.headers.get("Location"), "Location").toBe("/setup");
    expect(response.headers.getSetCookie(), "Set-Cookie").toContain(
      `${SESSION_COOKIE}=; Max-Age=0; ${SESSION_COOKIE_ATTRIBUTES}`,
    );
  });

  it("handleSetup renders the session-bound token of the request's seluna_csrf cookie on the start page", async () => {
    const response = await call("/setup", { cookies: [await sessionCookie(), csrfCookie()] });

    const html = await response.text();
    expectStartPage(html);
    expect(html, "page").toContain(`value="${await sessionCsrfToken(await sessionToken())}"`);
    expect(setCookiesOf(response, CSRF_COOKIE), "seluna_csrf cookies").toEqual([]);
  });

  it("handleSetup sets a new seluna_csrf cookie on the start page and renders its session-bound token", async () => {
    const response = await call("/setup", { cookies: [await sessionCookie()] });

    const cookies = setCookiesOf(response, CSRF_COOKIE);
    const match = /^seluna_csrf=([A-Za-z0-9_-]{43}); Path=\/setup; HttpOnly; Secure; SameSite=Strict$/.exec(
      cookies[0] ?? "",
    );
    expect(cookies.length, "number of seluna_csrf cookies").toBe(1);
    expect(match, "form of the seluna_csrf cookie").not.toBeNull();
    const session = await sessionToken();
    expect(await response.text(), "page").toContain(`value="${await sessionCsrfToken(session, match?.[1] ?? "")}"`);
  });

  it("handleSetup accepts the token of the form-expired start page for a second logout", async () => {
    const cookies = [await sessionCookie(), csrfCookie()];
    const expired = await call("/setup/logout", { method: "POST", cookies, body: form([["csrf", await csrfToken()]]) });
    const token = renderedToken(await expired.text());

    const response = await call("/setup/logout", { method: "POST", cookies, body: form([["csrf", token]]) });

    expect(expired.status, "status of the form-expired page").toBe(403);
    expect(token, "rendered token").toBe(await sessionCsrfToken(await sessionToken()));
    expect(response.status, "status").toBe(303);
    expect(response.headers.getSetCookie(), "Set-Cookie").toContain(
      `${SESSION_COOKIE}=; Max-Age=0; ${SESSION_COOKIE_ATTRIBUTES}`,
    );
  });

  it.each([
    { method: "GET", path: "/setup/other" },
    { method: "GET", path: "/setup/login" },
    { method: "POST", path: "/setup" },
  ])("handleSetup answers $method $path with a session with 404 and an empty body", async ({ method, path }) => {
    const response = await call(path, { method, cookies: [await sessionCookie()] });

    expect(response.status, "status").toBe(404);
    expect(await response.text(), "body").toBe("");
  });
});

describe("handleSetup without a usable SELUNA_SECRET", () => {
  const SECRETS = [
    { secretName: "absent", env: {} },
    { secretName: "a number", env: { SELUNA_SECRET: 42 } },
    { secretName: "31 characters", env: { SELUNA_SECRET: "a".repeat(31) } },
  ];
  const REQUESTS = [
    { method: "GET", path: "/setup" },
    { method: "POST", path: "/setup/login" },
  ];

  it.each(SECRETS.flatMap((secret) => REQUESTS.map((request) => ({ ...secret, ...request }))))(
    "handleSetup answers $method $path with 503 and the not-configured page when SELUNA_SECRET is $secretName",
    async ({ method, path, env: secretEnv }) => {
      const response = await call(
        path,
        {
          method,
          cookies: [csrfCookie()],
          body:
            method === "POST"
              ? form([
                  ["csrf", await csrfToken()],
                  ["secret", SECRET],
                ])
              : undefined,
        },
        depsAt(NOW.getTime(), { env: secretEnv }),
      );

      expect(response.status, "status").toBe(503);
      const html = await response.text();
      expect(html, "SELUNA_SECRET").toContain("SELUNA_SECRET");
      expect(html, "minimum length").toContain("32");
      expect(html, "openssl command").toContain("openssl rand -hex 32");
      expect(html, "wrangler command").toContain("wrangler secret put SELUNA_SECRET");
      expect(html, "form").not.toContain("<form");
      expect(response.headers.getSetCookie(), "Set-Cookie").toEqual([]);
      expect(await storedAttempts(), "stored attempts").toBeUndefined();
    },
  );

  it("handleSetup shows the login page for a SELUNA_SECRET of 32 characters outside the Basic Multilingual Plane", async () => {
    const secret = String.fromCodePoint(0x1f511).repeat(32);

    const response = await call("/setup", {}, depsAt(NOW.getTime(), { env: { SELUNA_SECRET: secret } }));

    expect(response.status, "status").toBe(200);
    expectLoginPage(await response.text());
  });
});

describe("handleSetup response headers", () => {
  it.each([
    { name: "the login page", response: () => call("/setup") },
    { name: "the 303 of a login", response: () => login(SECRET) },
    {
      name: "a 404 with a session",
      response: async () => call("/setup/other", { cookies: [await sessionCookie()] }),
    },
    {
      name: "a 413",
      response: () => call("/setup/login", { method: "POST", body: "a".repeat(MAX_BODY_BYTES + 1) }),
    },
  ])("handleSetup sets the security headers on $name", async ({ response }) => {
    const answered = await response();

    expect(answered.headers.get("Content-Security-Policy"), "Content-Security-Policy").toBe(
      await contentSecurityPolicy(),
    );
    expect(answered.headers.get("X-Content-Type-Options"), "X-Content-Type-Options").toBe("nosniff");
    expect(answered.headers.get("X-Frame-Options"), "X-Frame-Options").toBe("DENY");
    expect(answered.headers.get("Referrer-Policy"), "Referrer-Policy").toBe("no-referrer");
    expect(answered.headers.get("Cache-Control"), "Cache-Control").toBe("no-store");
  });

  it("handleSetup answers the German language link of the form-expired start page with 200 and the start page", async () => {
    const cookies = [await sessionCookie(), csrfCookie()];
    const expired = await call("/setup/logout", { method: "POST", cookies, body: form([["csrf", "wrong"]]) });
    const href = /href="([^"]*lang=de[^"]*)"/.exec(await expired.text())?.[1] ?? "";
    const target = new URL(href, `${ORIGIN}/setup/logout`);

    const response = await call(`${target.pathname}${target.search}`, { cookies });

    expect(expired.status, "status of the form-expired page").toBe(403);
    expect(response.status, "status of the German link").toBe(200);
    const html = await response.text();
    expectStartPage(html);
    expect(html, "html lang").toContain('<html lang="de">');
  });
});

describe("handleSetup language", () => {
  it("handleSetup renders German and sets seluna_lang for ?lang=de", async () => {
    const response = await call("/setup?lang=de");

    expect(await response.text(), "page").toContain('<html lang="de">');
    expect(response.headers.get("Content-Language"), "Content-Language").toBe("de");
    expect(response.headers.getSetCookie(), "Set-Cookie").toContain(
      `seluna_lang=de; Max-Age=31536000; ${SESSION_COOKIE_ATTRIBUTES}`,
    );
  });

  it("handleSetup renders German for a seluna_lang=de cookie", async () => {
    const response = await call("/setup", { cookies: ["seluna_lang=de"] });

    expect(await response.text(), "page").toContain('<html lang="de">');
    expect(response.headers.get("Content-Language"), "Content-Language").toBe("de");
  });

  it("handleSetup renders German for Accept-Language de-DE,de;q=0.9", async () => {
    const response = await call("/setup", { headers: { "accept-language": "de-DE,de;q=0.9" } });

    expect(await response.text(), "page").toContain('<html lang="de">');
    expect(response.headers.get("Content-Language"), "Content-Language").toBe("de");
  });
});

describe("handleSetup bodies and failures", () => {
  it("handleSetup answers a login body over 1 MiB with 413 and does not count it", async () => {
    const response = await call("/setup/login", { method: "POST", body: "a".repeat(MAX_BODY_BYTES + 1) });

    expect(response.status, "status").toBe(413);
    expect(await response.text(), "body").toBe("");
    expect(await storedAttempts(), "stored attempts").toBeUndefined();
  });

  it("handleSetup answers a logout body over 1 MiB with 413", async () => {
    const response = await call("/setup/logout", {
      method: "POST",
      cookies: [await sessionCookie()],
      body: "a".repeat(MAX_BODY_BYTES + 1),
    });

    expect(response.status, "status").toBe(413);
    expect(await response.text(), "body").toBe("");
  });

  it("handleSetup answers an unreadable login body with 400", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("connection lost"));
      },
    });

    const response = await call("/setup/login", { method: "POST", body });

    expect(response.status, "status").toBe(400);
    expect(await response.text(), "body").toBe("");
    expect(await storedAttempts(), "stored attempts").toBeUndefined();
  });

  it("handleSetup answers a login with 503 and the unavailable notice when D1 fails", async () => {
    const response = await login(SECRET, depsAt(NOW.getTime(), { db: migrationTestDb() }));

    expect(response.status, "status").toBe(503);
    const html = await response.text();
    expectLoginPage(html);
    expect(html, "unavailable notice").toContain(noticeText("unavailable"));
    expect(html.toLowerCase(), "error text").not.toContain("no such table");
    expect(setCookiesOf(response, SESSION_COOKIE), "session cookies").toEqual([]);
  });
});

const BOT_TOKEN = "123456789:AAH-throwaway_token0123456789abcdefghij";
const CHAT_SECRET_VALUE = "987654321";
const STEP_PATH = "/setup/telegram";
const VERIFY_PATH = "/setup/telegram/verify";
const PRIVATE_CHAT = 5_001_001;
const OTHER_CHAT = 5_002_002;
const GROUP_CHAT = -4_001_001;
const CODE = "123456";

/** Setup dependencies that reach Telegram through `telegram`, with a usable bot token unless `overrides` says otherwise. */
function telegramDeps(telegram: TelegramDouble, overrides: Partial<SetupDeps> = {}): SetupDeps {
  return depsAt(NOW.getTime(), {
    env: { SELUNA_SECRET: SECRET, TELEGRAM_BOT_TOKEN: BOT_TOKEN },
    fetch: telegram.fetch,
    ...overrides,
  });
}

/** Dependencies whose environment also holds the Worker secret `TELEGRAM_CHAT_ID`. */
function chatSecretDeps(telegram: TelegramDouble, overrides: Partial<SetupDeps> = {}): SetupDeps {
  return telegramDeps(telegram, {
    env: { SELUNA_SECRET: SECRET, TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_CHAT_ID: CHAT_SECRET_VALUE },
    ...overrides,
  });
}

async function signedInCookies(): Promise<string[]> {
  return [await sessionCookie(), csrfCookie()];
}

/** `GET` of `path` with a valid session. */
async function stepPage(deps: SetupDeps, path: string = STEP_PATH): Promise<Response> {
  return call(path, { cookies: await signedInCookies() }, deps);
}

/** `POST` of `fields` to `path` with a valid session. */
async function postSignedIn(path: string, fields: FormFields, deps: SetupDeps): Promise<Response> {
  return call(path, { method: "POST", cookies: await signedInCookies(), body: form(fields) }, deps);
}

async function validCsrf(): Promise<string> {
  return sessionCsrfToken(await sessionToken());
}

/** The fields of a confirm form: a valid session-bound token and one `chat` field per entry of `chats`. */
async function confirmFields(chats: readonly string[]): Promise<FormFields> {
  return [["csrf", await validCsrf()], ...chats.map((chat): [string, string] => ["chat", chat])];
}

function confirm(chats: readonly string[], deps: SetupDeps, path: string = STEP_PATH): Promise<Response> {
  return confirmFields(chats).then((fields) => postSignedIn(path, fields, deps));
}

/** The fields of a verify form: a valid session-bound token, then the given `proof` and `code` fields. */
async function verifyFields(proofs: readonly string[], codes: readonly string[]): Promise<FormFields> {
  return [
    ["csrf", await validCsrf()],
    ...proofs.map((proof): [string, string] => ["proof", proof]),
    ...codes.map((code): [string, string] => ["code", code]),
  ];
}

async function verify(proofs: readonly string[], codes: readonly string[], deps: SetupDeps): Promise<Response> {
  return postSignedIn(VERIFY_PATH, await verifyFields(proofs, codes), deps);
}

/** A proof for `chatId` and `code` as the test message of a confirm form at `NOW` in the valid session would give. */
async function proofFor(
  chatId: number,
  code: string = CODE,
  options: { readonly session?: string; readonly secret?: string; readonly createdAt?: Date } = {},
): Promise<string> {
  return createChatProof(
    await signingKeyFor(options.secret ?? SECRET, "setup-telegram"),
    options.session ?? (await sessionToken()),
    chatId,
    code,
    options.createdAt ?? NOW,
  );
}

/** The saved chat id text in `settings`, or `undefined`. */
async function savedChat(): Promise<unknown> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'telegram_chat_id'").first();
  return row?.value;
}

async function settingsRowCount(): Promise<unknown> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM settings").first();
  return row?.total;
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** The values of the radio inputs named `chat` of `html`. */
function radioValues(html: string): string[] {
  const inputs = html.match(/<input\b(?=[^>]*type="radio")(?=[^>]*name="chat")[^>]*>/g) ?? [];
  return inputs.map((input) => /value="([^"]*)"/.exec(input)?.[1] ?? "");
}

/** The value of the hidden input `name` of `html`, or an empty text. */
function hiddenValue(html: string, name: string): string {
  const pattern = new RegExp(`<input\\b(?=[^>]*type="hidden")(?=[^>]*name="${name}")[^>]*>`);
  return /value="([^"]*)"/.exec(pattern.exec(html)?.[0] ?? "")?.[1] ?? "";
}

/** The search link of the Telegram page: a link to the step with the text `telegramSearchLink`. */
function expectSearchLink(html: string, language: "en" | "de" = "en"): void {
  const text = escapeRegExp(escapeHtml(TEXTS[language].telegramSearchLink));
  expect(html, "search link").toMatch(new RegExp(`<a\\b[^>]*href="/setup/telegram"[^>]*>\\s*${text}\\s*</a>`));
}

/** The notice-only Telegram page: heading, intro, `notice` and the search link, and no form. */
function expectNoticeOnlyPage(html: string, notice: Notice): void {
  expect(html, "heading").toContain(`<h1>${escapeHtml(TEXTS.en.telegramHeading)}</h1>`);
  expect(html, "intro").toContain(escapeHtml(TEXTS.en.telegramIntro));
  expect(html, "notice").toContain(noticeText(notice));
  expectSearchLink(html);
  expect(html, "form").not.toContain("<form");
}

/** The code page for `chatId`: it names the chat, has the verify form, the code input and the same `proof`. */
function expectCodePage(html: string, chatId: number, proof: string): void {
  const sent = escapeRegExp(escapeHtml(TEXTS.en.telegramCodeSent));
  expect(html, "heading").toContain(`<h1>${escapeHtml(TEXTS.en.telegramHeading)}</h1>`);
  expect(html, "code sent text with the chat id").toMatch(new RegExp(`${sent}[^0-9-]{0,40}${String(chatId)}\\b`));
  expect(html, "code intro").toContain(escapeHtml(TEXTS.en.telegramCodeIntro));
  expect(html, "verify form").toMatch(/<form\b(?=[^>]*method="post")(?=[^>]*action="\/setup\/telegram\/verify")[^>]*>/);
  expect(hiddenValue(html, "proof"), "proof field").toBe(proof);
  const codeInput = /<input\b(?=[^>]*name="code")[^>]*>/.exec(html)?.[0] ?? "";
  expect(codeInput, "code input is required").toMatch(/\brequired\b/);
  expect(codeInput, "code input inputmode").toContain('inputmode="numeric"');
  expect(codeInput, "code input autocomplete").toContain('autocomplete="one-time-code"');
  expect(codeInput, "code input pattern").toContain('pattern="[0-9]{6}"');
  expect(codeInput, "code input maxlength").toContain('maxlength="6"');
  expect(html, "code button").toContain(escapeHtml(TEXTS.en.telegramCodeButton));
  expectSearchLink(html);
}

/** The text of the first `sendMessage` request the double recorded, or an empty text. */
function sentText(telegram: TelegramDouble): string {
  const body = telegram.requests[0]?.body;
  return typeof body === "object" && body !== null && "text" in body && typeof body.text === "string" ? body.text : "";
}

/** The code at the end of the test message. */
function sentCode(telegram: TelegramDouble): string {
  return /(\d{6})$/.exec(sentText(telegram))?.[1] ?? "";
}

const FIXTURE_RADIO_VALUES = ["5003003", "5002002", "-1001234567890", "-4001001", "5001001"];

describe("handleSetup Telegram step page", () => {
  it("handleSetup shows the Telegram step with the private chat and the group found", async () => {
    const telegram = telegramDouble();

    const response = await stepPage(telegramDeps(telegram));

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "heading").toContain(`<h1>${escapeHtml(TEXTS.en.telegramHeading)}</h1>`);
    expect(html, "intro").toContain(escapeHtml(TEXTS.en.telegramIntro));
    expect(html, "no saved chat text").toContain(escapeHtml(TEXTS.en.telegramNoSavedChat));
    expect(html, "chats intro").toContain(escapeHtml(TEXTS.en.telegramChatsIntro));
    expectSearchLink(html);
    expect(radioValues(html), "chat ids of the radio inputs, newest first").toEqual(FIXTURE_RADIO_VALUES);
    expect(html.match(/<input\b(?=[^>]*type="radio")[^>]*\brequired\b/g)?.length, "required radio inputs").toBe(5);
    expect(html, "name and username of the private chat").toContain("Anna Beispiel");
    expect(html, "username").toContain("@anna_example");
    expect(html, "group title").toContain("Seluna Testgroup");
    expect(html, "supergroup title").toContain("Seluna Supergroup");
    expect(html, "private chat kind").toContain(escapeHtml(TEXTS.en.telegramPrivateChat));
    expect(html, "group kind").toContain(escapeHtml(TEXTS.en.telegramGroup));
    expect(html, "confirm form").toMatch(/<form\b(?=[^>]*method="post")(?=[^>]*action="\/setup\/telegram")[^>]*>/);
    expect(hiddenValue(html, "csrf"), "session-bound CSRF token").toBe(await validCsrf());
    expect(html, "confirm button").toContain(escapeHtml(TEXTS.en.telegramConfirmButton));
  });

  it("handleSetup calls getUpdates exactly once per Telegram step page", async () => {
    const telegram = telegramDouble();

    await stepPage(telegramDeps(telegram));

    expect(telegram.methods(), "Bot API methods called").toEqual(["getUpdates"]);
    expect(telegram.requests[0]?.token, "token in the URL").toBe(BOT_TOKEN);
  });

  it("handleSetup shows the no-chats text and no form when getUpdates finds no chat", async () => {
    const telegram = telegramDouble({ getUpdates: jsonAnswer(200, updatesAnswer([])) });

    const response = await stepPage(telegramDeps(telegram));

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "no chats text").toContain(escapeHtml(TEXTS.en.telegramNoChats));
    expect(html, "no chats intro").not.toContain(escapeHtml(TEXTS.en.telegramChatsIntro));
    expect(radioValues(html), "radio inputs").toEqual([]);
    expect(html, "confirm form").not.toContain('action="/setup/telegram"');
    expectSearchLink(html);
  });

  it("handleSetup shows the saved chat id on the Telegram step", async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', '-1001234567890')").run();
    const telegram = telegramDouble();

    const response = await stepPage(telegramDeps(telegram));

    const html = await response.text();
    const saved = escapeRegExp(escapeHtml(TEXTS.en.telegramSavedChat));
    expect(html, "saved chat line").toMatch(new RegExp(`${saved}[^0-9-]{0,40}-1001234567890`));
    expect(html, "no saved chat text").not.toContain(escapeHtml(TEXTS.en.telegramNoSavedChat));
  });

  it.each([
    { name: "a text", stored: "abc" },
    { name: "zero", stored: "0" },
    { name: "a number with a trailing space", stored: "12 " },
    { name: "a number with an exponent", stored: "1e5" },
    { name: "markup", stored: "<b>1</b>" },
  ])(
    "handleSetup shows no saved chat for a stored telegram_chat_id that is not a chat id: $name",
    async ({ stored }) => {
      await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', ?1)").bind(stored).run();
      const telegram = telegramDouble();

      const response = await stepPage(telegramDeps(telegram));

      const html = await response.text();
      expect(response.status, "status").toBe(200);
      expect(html, "no saved chat text").toContain(escapeHtml(TEXTS.en.telegramNoSavedChat));
      expect(html, "saved chat line").not.toContain(escapeHtml(TEXTS.en.telegramSavedChat));
      // The page's style and the chat list (ids such as 5003003) legitimately contain digits like "0": check the
      // text between the end of the style element and the chat form, and the text after the form.
      const styleEnd = html.indexOf("</style>");
      const formStart = html.indexOf("<form");
      const formEnd = html.indexOf("</form>");
      expect(styleEnd, "end of the style element found").toBeGreaterThanOrEqual(0);
      expect(formStart, "chat form found after the style element").toBeGreaterThan(styleEnd);
      expect(formEnd, "end of the chat form found").toBeGreaterThan(formStart);
      const segments = [html.slice(styleEnd, formStart), html.slice(formEnd)];
      for (const segment of segments) {
        expect(segment, "stored text outside the style element and the chat form").not.toContain(escapeHtml(stored));
      }
    },
  );

  it("handleSetup shows the Telegram step in German for ?lang=de", async () => {
    const telegram = telegramDouble();

    const response = await stepPage(telegramDeps(telegram), `${STEP_PATH}?lang=de`);

    const html = await response.text();
    expect(html, "html lang").toContain('<html lang="de">');
    expect(html, "German heading").toContain(`<h1>${escapeHtml(TEXTS.de.telegramHeading)}</h1>`);
    expect(html, "German chats intro").toContain(escapeHtml(TEXTS.de.telegramChatsIntro));
  });
});

describe("handleSetup Telegram step without a session", () => {
  it.each([
    { method: "GET", path: STEP_PATH },
    { method: "POST", path: STEP_PATH },
    { method: "POST", path: VERIFY_PATH },
  ])(
    "handleSetup answers $method $path without a session with the login page and calls no Telegram API",
    async ({ method, path }) => {
      const telegram = telegramDouble();
      const init =
        method === "POST"
          ? {
              method,
              body: form([
                ["csrf", await csrfToken()],
                ["chat", String(PRIVATE_CHAT)],
              ]),
              cookies: [csrfCookie()],
            }
          : { method };

      const response = await call(path, init, telegramDeps(telegram));

      expect(response.status, "status").toBe(200);
      expectLoginPage(await response.text());
      expect(telegram.requests, "Telegram requests").toEqual([]);
      expect(await settingsRowCount(), "number of settings rows").toBe(0);
    },
  );
});

describe("handleSetup Telegram step page problems", () => {
  it("handleSetup shows the token-missing notice and calls no Telegram API", async () => {
    const telegram = telegramDouble();

    const response = await stepPage(telegramDeps(telegram, { env: { SELUNA_SECRET: SECRET } }));

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "notice").toContain(noticeText("telegram-token-missing"));
    expect(radioValues(html), "radio inputs").toEqual([]);
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it.each([
    { name: "with a slash", token: "1:a/../setWebhook" },
    { name: "with a trailing line feed", token: `${BOT_TOKEN}\n` },
    { name: "with a space", token: ` ${BOT_TOKEN}` },
    { name: "without a colon", token: "123456789" },
  ])("handleSetup shows the token-malformed notice and calls no Telegram API: $name", async ({ token }) => {
    const telegram = telegramDouble();

    const response = await stepPage(
      telegramDeps(telegram, { env: { SELUNA_SECRET: SECRET, TELEGRAM_BOT_TOKEN: token } }),
    );

    expect(response.status, "status").toBe(200);
    expect(await response.text(), "notice").toContain(noticeText("telegram-token-malformed"));
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it.each([{ status: 401 }, { status: 404 }])(
    "handleSetup shows the token-rejected notice when getUpdates answers $status",
    async ({ status }) => {
      const telegram = telegramDouble({ getUpdates: jsonAnswer(status, FIXTURES.unauthorized) });

      const response = await stepPage(telegramDeps(telegram));

      expect(response.status, "status").toBe(200);
      const html = await response.text();
      expect(html, "notice").toContain(noticeText("telegram-token-rejected"));
      expect(html, "bot token").not.toContain(BOT_TOKEN);
      expect(html, "Telegram description").not.toContain("Unauthorized");
      expect(radioValues(html), "radio inputs").toEqual([]);
    },
  );

  it("handleSetup shows the conflict notice when getUpdates answers 409", async () => {
    const telegram = telegramDouble({ getUpdates: jsonAnswer(409, FIXTURES.conflict) });

    const response = await stepPage(telegramDeps(telegram));

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "notice").toContain(noticeText("telegram-conflict"));
    expect(html, "Telegram description").not.toContain("deleteWebhook");
    expect(telegram.methods(), "Bot API methods called").toEqual(["getUpdates"]);
  });

  it.each<{ name: string; answer: TelegramAnswer }>([
    {
      name: "status 500",
      answer: jsonAnswer(500, { ok: false, error_code: 500, description: "Internal Server Error" }),
    },
    { name: "a rejected fetch", answer: REJECTED },
    { name: "an answer that is not JSON", answer: { kind: "raw", status: 200, body: "<html>" } },
    { name: "an answer without a result", answer: jsonAnswer(200, { ok: true }) },
  ])("handleSetup shows the Telegram-unavailable notice when getUpdates fails: $name", async ({ answer }) => {
    const telegram = telegramDouble({ getUpdates: answer });

    const response = await stepPage(telegramDeps(telegram));

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "notice").toContain(noticeText("telegram-unavailable"));
    expect(html, "runtime error text").not.toContain("Network connection lost");
    expect(html, "Telegram description").not.toContain("Internal Server Error");
  });

  it("handleSetup answers the Telegram step with 503 and calls no Telegram API when D1 fails", async () => {
    const telegram = telegramDouble();

    const response = await stepPage(telegramDeps(telegram, { db: migrationTestDb() }));

    expect(response.status, "status").toBe(503);
    const html = await response.text();
    expectNoticeOnlyPage(html, "unavailable");
    expect(html.toLowerCase(), "error text").not.toContain("no such table");
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("handleSetup shows the Telegram step as configured by TELEGRAM_CHAT_ID without calling Telegram", async () => {
    const telegram = telegramDouble();

    const response = await stepPage(chatSecretDeps(telegram, { db: migrationTestDb() }));

    expect(response.status, "status (a read of D1 would answer 503)").toBe(200);
    const html = await response.text();
    expect(html, "chat id secret text").toContain(escapeHtml(TEXTS.en.telegramChatIdSecret));
    expect(html, "chats intro").not.toContain(escapeHtml(TEXTS.en.telegramChatsIntro));
    expect(html, "form").not.toContain("<form");
    expect(html, "saved chat line").not.toContain(escapeHtml(TEXTS.en.telegramSavedChat));
    expect(html, "no saved chat text").not.toContain(escapeHtml(TEXTS.en.telegramNoSavedChat));
    expect(html, "value of the secret").not.toContain(CHAT_SECRET_VALUE);
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });
});

/** Ways a signed-in form can fail the session-bound CSRF check: the `csrf` field values to send. */
const CSRF_FAILURES: readonly { readonly name: string; readonly tokens: () => Promise<string[]> }[] = [
  { name: "no csrf field", tokens: () => Promise.resolve([]) },
  { name: "a wrong token", tokens: async () => [withFirstCharacterChanged(await validCsrf())] },
  { name: "the unbound login-form token", tokens: async () => [await csrfToken()] },
  {
    name: "a token bound to another session",
    tokens: async () => [await sessionCsrfToken(await sessionToken(new Date(NOW.getTime() - 3_600_000)))],
  },
  { name: "two csrf fields", tokens: async () => [await validCsrf(), await validCsrf()] },
];

describe("handleSetup Telegram confirm form", () => {
  it("handleSetup sends a test message with a six-digit code to the confirmed private chat and stores nothing yet", async () => {
    const telegram = telegramDouble();

    const response = await confirm([String(PRIVATE_CHAT)], telegramDeps(telegram));

    expect(response.status, "status").toBe(200);
    expect(telegram.methods(), "Bot API methods called").toEqual(["sendMessage"]);
    const [request] = telegram.requests;
    expect(request?.token, "token in the URL").toBe(BOT_TOKEN);
    expect(sentCode(telegram), "code at the end of the text").toMatch(/^\d{6}$/);
    expect(request?.body, "request body: chat id as a number, test message and code, no parse_mode").toEqual({
      chat_id: PRIVATE_CHAT,
      text: `${TEXTS.en.telegramTestMessage} ${sentCode(telegram)}`,
    });
    expect(await settingsRowCount(), "number of settings rows").toBe(0);
  });

  it("handleSetup sends a test message with a six-digit code to the confirmed group and stores nothing yet", async () => {
    const telegram = telegramDouble();

    const response = await confirm([String(GROUP_CHAT)], telegramDeps(telegram));

    expect(response.status, "status").toBe(200);
    expect(telegram.methods(), "Bot API methods called").toEqual(["sendMessage"]);
    expect(telegram.requests[0]?.body, "request body with the negative group id as a number").toEqual({
      chat_id: GROUP_CHAT,
      text: `${TEXTS.en.telegramTestMessage} ${sentCode(telegram)}`,
    });
    expect(sentCode(telegram), "code at the end of the text").toMatch(/^\d{6}$/);
    expect(await settingsRowCount(), "number of settings rows").toBe(0);
  });

  it("handleSetup shows the code form with a proof for the chat and without the code", async () => {
    const telegram = telegramDouble();

    const response = await confirm([String(PRIVATE_CHAT)], telegramDeps(telegram));

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    const code = sentCode(telegram);
    expectCodePage(html, PRIVATE_CHAT, await proofFor(PRIVATE_CHAT, code));
    expect(hiddenValue(html, "csrf"), "session-bound CSRF token").toBe(await validCsrf());
    expect(html, "the code").not.toContain(code);
    expect([...response.headers.values()].join("\n"), "the code in the headers").not.toContain(code);
    expect(html, "bot token").not.toContain(BOT_TOKEN);
  });

  it("handleSetup sends the test message in German for a German page", async () => {
    const telegram = telegramDouble();

    const response = await confirm([String(PRIVATE_CHAT)], telegramDeps(telegram), `${STEP_PATH}?lang=de`);

    expect(response.status, "status").toBe(200);
    expect(sentText(telegram), "test message").toBe(`${TEXTS.de.telegramTestMessage} ${sentCode(telegram)}`);
    expect(await response.text(), "German code page").toContain(escapeHtml(TEXTS.de.telegramCodeIntro));
  });

  it("handleSetup saves the chat after the code of its test message is typed back", async () => {
    const telegram = telegramDouble();
    const deps = telegramDeps(telegram);
    const codePage = await (await confirm([String(GROUP_CHAT)], deps)).text();

    const response = await verify([hiddenValue(codePage, "proof")], [sentCode(telegram)], deps);

    expect(response.status, "status").toBe(303);
    expect(response.headers.get("Location"), "Location").toBe(STEP_PATH);
    expect(await savedChat(), "saved chat").toBe(String(GROUP_CHAT));
    expect(telegram.methods(), "Bot API methods called").toEqual(["sendMessage"]);
  });

  it.each(CSRF_FAILURES)(
    "handleSetup rejects the confirm form without a valid session-bound CSRF token with 403 and calls no Telegram API: $name",
    async ({ tokens: tokensOf }) => {
      const telegram = telegramDouble();
      const csrf = (await tokensOf()).map((token): [string, string] => ["csrf", token]);

      const response = await postSignedIn(STEP_PATH, [...csrf, ["chat", String(PRIVATE_CHAT)]], telegramDeps(telegram));

      expect(response.status, "status").toBe(403);
      expectNoticeOnlyPage(await response.text(), "form-expired");
      expect(telegram.requests, "Telegram requests").toEqual([]);
      expect(await settingsRowCount(), "number of settings rows").toBe(0);
    },
  );

  it.each([
    { name: "missing", chats: [] as string[] },
    { name: "repeated", chats: [String(PRIVATE_CHAT), String(PRIVATE_CHAT)] },
    { name: "two different chats", chats: [String(PRIVATE_CHAT), String(OTHER_CHAT)] },
    { name: "empty", chats: [""] },
    { name: "zero", chats: ["0"] },
    { name: "minus zero", chats: ["-0"] },
    { name: "a leading plus", chats: ["+5001001"] },
    { name: "leading zeros", chats: ["05001001"] },
    { name: "whitespace around", chats: [" 5001001 "] },
    { name: "an exponent", chats: ["1e5"] },
    { name: "hexadecimal", chats: ["0x10"] },
    { name: "a decimal point", chats: ["1.0"] },
    { name: "non-ASCII digits", chats: ["\u0661\u0662\u0663"] },
    { name: "a channel name", chats: ["@channelname"] },
    { name: "17 digits", chats: ["12345678901234567"] },
    { name: "16 digits above the largest safe integer", chats: ["9007199254740992"] },
  ])(
    "handleSetup rejects a missing, repeated or malformed chat field with 400 and calls no Telegram API: $name",
    async ({ chats }) => {
      const telegram = telegramDouble();

      const response = await confirm(chats, telegramDeps(telegram));

      expect(response.status, "status").toBe(400);
      expectNoticeOnlyPage(await response.text(), "telegram-invalid-chat");
      expect(telegram.requests, "Telegram requests").toEqual([]);
      expect(await settingsRowCount(), "number of settings rows").toBe(0);
    },
  );

  it("handleSetup shows no code form and answers 502 when the test message fails", async () => {
    const telegram = telegramDouble({
      sendMessage: jsonAnswer(403, {
        ok: false,
        error_code: 403,
        description: "Forbidden: bot was blocked by the user",
      }),
    });

    const response = await confirm([String(PRIVATE_CHAT)], telegramDeps(telegram));

    expect(response.status, "status").toBe(502);
    const html = await response.text();
    expectNoticeOnlyPage(html, "telegram-send-failed");
    expect(html, "verify form").not.toContain("/setup/telegram/verify");
    expect(html, "Telegram description").not.toContain("blocked by the user");
    expect(await settingsRowCount(), "number of settings rows").toBe(0);
  });

  it.each<{ name: string; answer: TelegramAnswer }>([
    { name: "status 400", answer: jsonAnswer(400, { ok: false, error_code: 400 }) },
    { name: "status 429", answer: jsonAnswer(429, { ok: false, error_code: 429 }) },
    { name: "status 500", answer: jsonAnswer(500, { ok: false, error_code: 500 }) },
    { name: "a 2xx answer with ok false", answer: jsonAnswer(200, { ok: false }) },
    { name: "a rejected fetch", answer: REJECTED },
    { name: "an answer that is not JSON", answer: { kind: "raw", status: 200, body: "OK" } },
  ])("handleSetup answers 502 with the send-failed notice when the test message fails: $name", async ({ answer }) => {
    const telegram = telegramDouble({ sendMessage: answer });

    const response = await confirm([String(PRIVATE_CHAT)], telegramDeps(telegram));

    expect(response.status, "status").toBe(502);
    expectNoticeOnlyPage(await response.text(), "telegram-send-failed");
    expect(await settingsRowCount(), "number of settings rows").toBe(0);
  });

  it.each([{ status: 401 }, { status: 404 }])(
    "handleSetup answers 502 with the token-rejected notice when sendMessage answers $status",
    async ({ status }) => {
      const telegram = telegramDouble({ sendMessage: jsonAnswer(status, FIXTURES.unauthorized) });

      const response = await confirm([String(PRIVATE_CHAT)], telegramDeps(telegram));

      expect(response.status, "status").toBe(502);
      const html = await response.text();
      expectNoticeOnlyPage(html, "telegram-token-rejected");
      expect(html, "bot token").not.toContain(BOT_TOKEN);
      expect(await settingsRowCount(), "number of settings rows").toBe(0);
    },
  );

  it("handleSetup answers 503 with the token-missing notice when the bot token is not set and calls no Telegram API", async () => {
    const telegram = telegramDouble();

    const response = await confirm([String(PRIVATE_CHAT)], telegramDeps(telegram, { env: { SELUNA_SECRET: SECRET } }));

    expect(response.status, "status").toBe(503);
    expectNoticeOnlyPage(await response.text(), "telegram-token-missing");
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("handleSetup answers 503 with the token-malformed notice when the bot token is malformed and calls no Telegram API", async () => {
    const telegram = telegramDouble();
    const deps = telegramDeps(telegram, { env: { SELUNA_SECRET: SECRET, TELEGRAM_BOT_TOKEN: "1:a/../setWebhook" } });

    const response = await confirm([String(PRIVATE_CHAT)], deps);

    expect(response.status, "status").toBe(503);
    expectNoticeOnlyPage(await response.text(), "telegram-token-malformed");
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("handleSetup checks the chat field before the bot token", async () => {
    const telegram = telegramDouble();

    const response = await confirm(["abc"], telegramDeps(telegram, { env: { SELUNA_SECRET: SECRET } }));

    expect(response.status, "status").toBe(400);
    expectNoticeOnlyPage(await response.text(), "telegram-invalid-chat");
  });

  it.each([
    { name: "a valid chat field", chats: [String(PRIVATE_CHAT)] },
    { name: "an invalid chat field", chats: ["abc"] },
  ])(
    "handleSetup answers the confirm form with 409 while TELEGRAM_CHAT_ID is set and sends nothing: $name",
    async ({ chats }) => {
      const telegram = telegramDouble();

      const response = await confirm(chats, chatSecretDeps(telegram));

      expect(response.status, "status").toBe(409);
      const html = await response.text();
      expect(html, "chat id secret text").toContain(escapeHtml(TEXTS.en.telegramChatIdSecret));
      expect(html, "form").not.toContain("<form");
      expect(html, "value of the secret").not.toContain(CHAT_SECRET_VALUE);
      expect(telegram.requests, "Telegram requests").toEqual([]);
      expect(await settingsRowCount(), "number of settings rows").toBe(0);
    },
  );

  it("handleSetup answers a confirm body over 1 MiB with 413", async () => {
    const telegram = telegramDouble();

    const response = await call(
      STEP_PATH,
      { method: "POST", cookies: await signedInCookies(), body: "a".repeat(MAX_BODY_BYTES + 1) },
      telegramDeps(telegram),
    );

    expect(response.status, "status").toBe(413);
    expect(await response.text(), "body").toBe("");
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("handleSetup answers an unreadable confirm body with 400", async () => {
    const telegram = telegramDouble();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("connection lost"));
      },
    });

    const response = await call(
      STEP_PATH,
      { method: "POST", cookies: await signedInCookies(), body },
      telegramDeps(telegram),
    );

    expect(response.status, "status").toBe(400);
    expect(await response.text(), "body").toBe("");
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });
});

describe("handleSetup Telegram verify form", () => {
  it("handleSetup saves the chat when the code of its test message is entered", async () => {
    const telegram = telegramDouble();

    const response = await verify([await proofFor(PRIVATE_CHAT)], [CODE], telegramDeps(telegram));

    expect(response.status, "status").toBe(303);
    expect(response.headers.get("Location"), "Location").toBe(STEP_PATH);
    expect(await savedChat(), "saved chat").toBe(String(PRIVATE_CHAT));
  });

  it("handleSetup saves a group chat when the code of its test message is entered", async () => {
    const telegram = telegramDouble();

    const response = await verify([await proofFor(GROUP_CHAT)], [CODE], telegramDeps(telegram));

    expect(response.status, "status").toBe(303);
    expect(await savedChat(), "saved chat").toBe(String(GROUP_CHAT));
  });

  it("handleSetup replaces an earlier saved chat", async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', '111')").run();
    const telegram = telegramDouble();

    const response = await verify([await proofFor(PRIVATE_CHAT)], [CODE], telegramDeps(telegram));

    expect(response.status, "status").toBe(303);
    expect(await savedChat(), "saved chat").toBe(String(PRIVATE_CHAT));
    expect(await settingsRowCount(), "number of settings rows").toBe(1);
  });

  it("handleSetup calls no Telegram API on the verify form", async () => {
    const telegram = telegramDouble();

    await verify([await proofFor(PRIVATE_CHAT)], [CODE], telegramDeps(telegram));
    await verify([await proofFor(PRIVATE_CHAT)], ["000000"], telegramDeps(telegram));

    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("handleSetup shows the saved chat on the Telegram step after the code was entered", async () => {
    const telegram = telegramDouble();
    const deps = telegramDeps(telegram);
    await verify([await proofFor(PRIVATE_CHAT)], [CODE], deps);

    const response = await stepPage(deps);

    const saved = escapeRegExp(escapeHtml(TEXTS.en.telegramSavedChat));
    expect(await response.text(), "saved chat line").toMatch(
      new RegExp(`${saved}[^0-9-]{0,40}${String(PRIVATE_CHAT)}`),
    );
  });

  it("handleSetup stores nothing and shows the wrong-code notice for a wrong code", async () => {
    const telegram = telegramDouble();
    const proof = await proofFor(PRIVATE_CHAT);

    const response = await verify([proof], ["654321"], telegramDeps(telegram));

    expect(response.status, "status").toBe(400);
    const html = await response.text();
    expectCodePage(html, PRIVATE_CHAT, proof);
    expect(html, "wrong code notice").toContain(noticeText("telegram-wrong-code"));
    expect(await settingsRowCount(), "number of settings rows").toBe(0);
  });

  it.each([
    { name: "missing", codes: [] as string[] },
    { name: "repeated", codes: [CODE, CODE] },
    { name: "empty", codes: [""] },
    { name: "of five digits", codes: ["12345"] },
    { name: "of seven digits", codes: ["1234567"] },
    { name: "letters", codes: ["12345a"] },
    { name: "with a space", codes: [" 123456"] },
  ])(
    "handleSetup shows the wrong-code notice for a missing, repeated or malformed code field: $name",
    async ({ codes }) => {
      const telegram = telegramDouble();
      const proof = await proofFor(PRIVATE_CHAT);

      const response = await verify([proof], codes, telegramDeps(telegram));

      expect(response.status, "status").toBe(400);
      const html = await response.text();
      expectCodePage(html, PRIVATE_CHAT, proof);
      expect(html, "wrong code notice").toContain(noticeText("telegram-wrong-code"));
      expect(await settingsRowCount(), "number of settings rows").toBe(0);
    },
  );

  it("handleSetup stores nothing when the code for chat A is sent with a proof altered to chat B", async () => {
    const telegram = telegramDouble();
    const [version = "", , expires = "", mac = ""] = (await proofFor(PRIVATE_CHAT)).split(".");
    const altered = [version, String(OTHER_CHAT), expires, mac].join(".");

    const response = await verify([altered], [CODE], telegramDeps(telegram));

    expect(response.status, "status").toBe(400);
    const html = await response.text();
    expectCodePage(html, OTHER_CHAT, altered);
    expect(html, "wrong code notice").toContain(noticeText("telegram-wrong-code"));
    expect(await settingsRowCount(), "number of settings rows").toBe(0);
  });

  it("handleSetup stores nothing for the proof and code of another session", async () => {
    const telegram = telegramDouble();
    const otherSession = await sessionToken(new Date(NOW.getTime() - 3_600_000));
    const proof = await proofFor(PRIVATE_CHAT, CODE, { session: otherSession });

    const response = await verify([proof], [CODE], telegramDeps(telegram));

    expect(response.status, "status").toBe(400);
    expect(await response.text(), "wrong code notice").toContain(noticeText("telegram-wrong-code"));
    expect(await settingsRowCount(), "number of settings rows").toBe(0);
  });

  it("handleSetup stores nothing for the proof and code of another SELUNA_SECRET", async () => {
    const telegram = telegramDouble();
    const proof = await proofFor(PRIVATE_CHAT, CODE, { secret: OTHER_SECRET });

    const response = await verify([proof], [CODE], telegramDeps(telegram));

    expect(response.status, "status").toBe(400);
    expect(await response.text(), "wrong code notice").toContain(noticeText("telegram-wrong-code"));
    expect(await settingsRowCount(), "number of settings rows").toBe(0);
  });

  it("handleSetup stores nothing and shows the code-expired notice for a proof older than 10 minutes", async () => {
    const telegram = telegramDouble();
    const proof = await proofFor(PRIVATE_CHAT, CODE, { createdAt: new Date(NOW.getTime() - 600_000) });

    const response = await verify([proof], [CODE], telegramDeps(telegram));

    expect(response.status, "status").toBe(400);
    expectNoticeOnlyPage(await response.text(), "telegram-code-expired");
    expect(await settingsRowCount(), "number of settings rows").toBe(0);
  });

  it.each([
    { name: "missing", proofs: (): Promise<string[]> => Promise.resolve([]) },
    {
      name: "repeated",
      proofs: async (): Promise<string[]> => [await proofFor(PRIVATE_CHAT), await proofFor(PRIVATE_CHAT)],
    },
    { name: "empty", proofs: (): Promise<string[]> => Promise.resolve([""]) },
    { name: "text", proofs: (): Promise<string[]> => Promise.resolve(["not-a-proof"]) },
    {
      name: "a proof with a changed version",
      proofs: async (): Promise<string[]> => [(await proofFor(PRIVATE_CHAT)).replace("v1.", "v2.")],
    },
  ])(
    "handleSetup stores nothing and shows the code-expired notice for a missing, repeated or malformed proof: $name",
    async ({ proofs }) => {
      const telegram = telegramDouble();

      const response = await verify(await proofs(), [CODE], telegramDeps(telegram));

      expect(response.status, "status").toBe(400);
      expectNoticeOnlyPage(await response.text(), "telegram-code-expired");
      expect(await settingsRowCount(), "number of settings rows").toBe(0);
    },
  );

  it.each(CSRF_FAILURES)(
    "handleSetup rejects the verify form without a valid session-bound CSRF token with 403: $name",
    async ({ tokens: tokensOf }) => {
      const telegram = telegramDouble();
      const csrf = (await tokensOf()).map((token): [string, string] => ["csrf", token]);

      const response = await postSignedIn(
        VERIFY_PATH,
        [...csrf, ["proof", await proofFor(PRIVATE_CHAT)], ["code", CODE]],
        telegramDeps(telegram),
      );

      expect(response.status, "status").toBe(403);
      expectNoticeOnlyPage(await response.text(), "form-expired");
      expect(await settingsRowCount(), "number of settings rows").toBe(0);
    },
  );

  it("handleSetup answers the verify form with 409 while TELEGRAM_CHAT_ID is set and stores nothing", async () => {
    const telegram = telegramDouble();

    const response = await verify([await proofFor(PRIVATE_CHAT)], [CODE], chatSecretDeps(telegram));

    expect(response.status, "status").toBe(409);
    const html = await response.text();
    expect(html, "chat id secret text").toContain(escapeHtml(TEXTS.en.telegramChatIdSecret));
    expect(html, "form").not.toContain("<form");
    expect(html, "value of the secret").not.toContain(CHAT_SECRET_VALUE);
    expect(await settingsRowCount(), "number of settings rows").toBe(0);
  });

  it("handleSetup answers 503 with the unavailable notice when saving the chat fails", async () => {
    const telegram = telegramDouble();

    const response = await verify(
      [await proofFor(PRIVATE_CHAT)],
      [CODE],
      telegramDeps(telegram, { db: migrationTestDb() }),
    );

    expect(response.status, "status").toBe(503);
    const html = await response.text();
    expectNoticeOnlyPage(html, "unavailable");
    expect(html.toLowerCase(), "error text").not.toContain("no such table");
    expect(await settingsRowCount(), "number of settings rows in the main database").toBe(0);
  });

  it("handleSetup answers a verify body over 1 MiB with 413", async () => {
    const telegram = telegramDouble();

    const response = await call(
      VERIFY_PATH,
      { method: "POST", cookies: await signedInCookies(), body: "a".repeat(MAX_BODY_BYTES + 1) },
      telegramDeps(telegram),
    );

    expect(response.status, "status").toBe(413);
    expect(await response.text(), "body").toBe("");
  });

  it("handleSetup answers an unreadable verify body with 400", async () => {
    const telegram = telegramDouble();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("connection lost"));
      },
    });

    const response = await call(
      VERIFY_PATH,
      { method: "POST", cookies: await signedInCookies(), body },
      telegramDeps(telegram),
    );

    expect(response.status, "status").toBe(400);
    expect(await response.text(), "body").toBe("");
  });
});

const GITHUB_PATH = "/setup/github";
const CALLBACK_PATH = "/setup/github/callback";
const OTHER_SESSION = "v1.1700043100000.othermacothermacothermacothermacother1";
const GITHUB_WORKER_SECRETS = {
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----",
  GITHUB_WEBHOOK_SECRET: "worker-webhook-secret-value",
};
const PERSONAL_GITHUB = { type: "personal", account: "github" } as const;

/** Setup dependencies that reach GitHub through `github`; `overrides` may change the environment or the database. */
function githubDeps(github: GitHubDouble, overrides: Partial<SetupDeps> = {}): SetupDeps {
  return depsAt(NOW.getTime(), { githubFetch: github.fetch, ...overrides });
}

/** Dependencies whose environment also holds the Worker secrets named in `secrets`. */
function githubSecretDeps(github: GitHubDouble, secrets: Record<string, string>): SetupDeps {
  return githubDeps(github, { env: { SELUNA_SECRET: SECRET, ...secrets } });
}

/** A state as the plan documents it for the valid session (or `session`), created at `createdAt` under `secret`. */
async function githubState(
  choice: { readonly type: "personal" | "organization"; readonly account: string },
  options: { readonly session?: string; readonly secret?: string; readonly createdAt?: Date } = {},
): Promise<string> {
  return stateFor(
    await signingKeyFor(options.secret ?? SECRET, "setup-github"),
    options.session ?? (await sessionToken()),
    choice,
    options.createdAt ?? NOW,
  );
}

function unescapeHtml(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

/** The `action` of the first form of `html`, unescaped, or an empty text. */
function formActionOf(html: string): string {
  const form = /<form\b(?=[^>]*method="post")[^>]*>/.exec(html)?.[0] ?? "";
  return unescapeHtml(/action="([^"]*)"/.exec(form)?.[1] ?? "");
}

async function secretsCount(): Promise<unknown> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM secrets").first();
  return row?.total;
}

async function keyCheckCount(): Promise<unknown> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM meta WHERE key = 'key_check'").first();
  return row?.total;
}

/** Stores the App ID under the key of `secret`; fails the test when it is not stored. */
async function seedAppId(secret: string, value: string): Promise<void> {
  const result = await writeSecret(env.DB, await keyFor(secret), "github_app_id", value);
  expect(result, "seeding github_app_id").toEqual({ kind: "ok" });
}

/** The notice-only GitHub page: heading, `notice` and the back link, and no form. */
function expectGitHubNoticeOnlyPage(html: string, notice: Notice): void {
  expect(html, "heading").toContain(`<h1>${escapeHtml(TEXTS.en.githubHeading)}</h1>`);
  expect(html, "notice").toContain(noticeText(notice));
  expect(html, "back link").toContain(`<a href="${GITHUB_PATH}">${escapeHtml(TEXTS.en.githubBackLink)}</a>`);
  expect(html, "form").not.toContain("<form");
}

/** The finish page: the finish form posting `code` and `state` to the callback path, and no csrf field. */
function expectFinishPage(html: string, code: string, state: string): void {
  expect(html, "finish text").toContain(escapeHtml(TEXTS.en.githubFinishIntro));
  expect(html, "finish button").toContain(escapeHtml(TEXTS.en.githubFinishButton));
  expect(html, "finish form").toMatch(/<form\b(?=[^>]*method="post")(?=[^>]*action="\/setup\/github\/callback")[^>]*>/);
  expect(unescapeHtml(hiddenValue(html, "code")), "code field").toBe(code);
  expect(unescapeHtml(hiddenValue(html, "state")), "state field").toBe(state);
  expect(html, "csrf field").not.toContain('name="csrf"');
}

describe("handleSetup GitHub step page", () => {
  it("GET /setup/github answers 200 with the account form and a session-bound CSRF field", async () => {
    const response = await stepPage(githubDeps(githubDouble()), GITHUB_PATH);

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "heading").toContain(`<h1>${escapeHtml(TEXTS.en.githubHeading)}</h1>`);
    expect(html, "intro").toContain(escapeHtml(TEXTS.en.githubIntro));
    expect(html, "no saved app text").toContain(escapeHtml(TEXTS.en.githubNoSavedApp));
    expect(html, "form").toMatch(/<form\b(?=[^>]*method="post")(?=[^>]*action="\/setup\/github")[^>]*>/);
    expect(html, "account type field").toContain('name="account_type"');
    expect(html, "personal value").toContain('value="personal"');
    expect(html, "organization value").toContain('value="organization"');
    expect(html, "personal text").toContain(escapeHtml(TEXTS.en.githubPersonal));
    expect(html, "organization text").toContain(escapeHtml(TEXTS.en.githubOrganization));
    expect(html, "account field").toMatch(/<input\b(?=[^>]*name="account")[^>]*>/);
    expect(html, "account label").toContain(escapeHtml(TEXTS.en.githubAccountLabel));
    expect(html, "next button").toContain(escapeHtml(TEXTS.en.githubNextButton));
    expect(hiddenValue(html, "csrf"), "session-bound CSRF token").toBe(await validCsrf());
  });

  it("GET /setup/github shows the saved App ID", async () => {
    await seedAppId(SECRET, "12345");

    const response = await stepPage(githubDeps(githubDouble()), GITHUB_PATH);

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "saved app line").toMatch(
      new RegExp(`${escapeRegExp(escapeHtml(TEXTS.en.githubSavedApp))}[^0-9]{0,40}12345`),
    );
    expect(html, "replace hint").toContain(escapeHtml(TEXTS.en.githubReplaceHint));
    expect(html, "no saved app text").not.toContain(escapeHtml(TEXTS.en.githubNoSavedApp));
  });

  it.each([
    { name: "all three Worker secrets", secrets: GITHUB_WORKER_SECRETS, text: TEXTS.en.githubWorkerSecrets },
    {
      name: "one Worker secret",
      secrets: { GITHUB_WEBHOOK_SECRET: GITHUB_WORKER_SECRETS.GITHUB_WEBHOOK_SECRET },
      text: TEXTS.en.githubPartialWorkerSecrets,
    },
  ])("GET /setup/github shows no form and no value for $name", async ({ secrets, text }) => {
    const response = await stepPage(githubSecretDeps(githubDouble(), secrets), GITHUB_PATH);

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "explanation").toContain(escapeHtml(text));
    expect(html, "form").not.toContain("<form");
    expect(html, "value of a Worker secret").not.toContain(GITHUB_WORKER_SECRETS.GITHUB_WEBHOOK_SECRET);
  });

  it("GET /setup/github shows the reset text and no form when the saved credentials cannot be read", async () => {
    await seedAppId(OTHER_SECRET, "12345");

    const response = await stepPage(githubDeps(githubDouble()), GITHUB_PATH);

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "reset text").toContain(escapeHtml(TEXTS.en.githubResetNeeded));
    expect(html, "form").not.toContain("<form");
  });

  it("GET /setup/github answers 503 with the unavailable notice when D1 fails", async () => {
    const response = await stepPage(githubDeps(githubDouble(), { db: migrationTestDb() }), GITHUB_PATH);

    expect(response.status, "status").toBe(503);
    const html = await response.text();
    expectGitHubNoticeOnlyPage(html, "unavailable");
    expect(html.toLowerCase(), "error text").not.toContain("no such table");
  });

  it("the start page links to /setup/telegram and /setup/github", async () => {
    const response = await stepPage(depsAt(), "/setup");

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "Telegram link").toContain(`<a href="/setup/telegram">${escapeHtml(TEXTS.en.telegramHeading)}</a>`);
    expect(html, "GitHub link").toContain(`<a href="/setup/github">${escapeHtml(TEXTS.en.githubHeading)}</a>`);
  });
});

/** The fields of a start form: a valid session-bound token, then the account types and the accounts. */
async function startFields(types: readonly string[], accounts: readonly string[]): Promise<FormFields> {
  return [
    ["csrf", await validCsrf()],
    ...types.map((type): [string, string] => ["account_type", type]),
    ...accounts.map((account): [string, string] => ["account", account]),
  ];
}

async function startGitHub(types: readonly string[], accounts: readonly string[], deps: SetupDeps): Promise<Response> {
  return postSignedIn(GITHUB_PATH, await startFields(types, accounts), deps);
}

describe("handleSetup GitHub start form", () => {
  it("POST /setup/github answers 200 with a review page that posts the manifest to GitHub for a personal account", async () => {
    const response = await startGitHub(["personal"], ["octocat"], githubDeps(githubDouble()));

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "review text").toContain(escapeHtml(TEXTS.en.githubReviewIntro));
    expect(html, "account").toContain("octocat");
    expect(html, "account type").toContain(escapeHtml(TEXTS.en.githubPersonal));
    expect(html, "app name").toContain("seluna-octocat");
    expect(html, "permissions").toContain(escapeHtml(TEXTS.en.githubPermissionsList));
    expect(html, "events").toContain(escapeHtml(TEXTS.en.githubEventsList));
    expect(html, "button").toContain(escapeHtml(TEXTS.en.githubToGitHubButton));
    expect(formActionOf(html), "form action").toMatch(
      /^https:\/\/github\.com\/settings\/apps\/new\?state=v1\.personal\.octocat\.1700003600000\.[\w-]{22}\.[\w-]{43}$/,
    );
    expect(unescapeHtml(hiddenValue(html, "manifest")), "manifest field").toBe(expectedManifestJson(ORIGIN, "octocat"));
  });

  it("POST /setup/github posts an organization's manifest to its organization settings", async () => {
    const response = await startGitHub(["organization"], ["Octo-Org"], githubDeps(githubDouble()));

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "account type").toContain(escapeHtml(TEXTS.en.githubOrganization));
    expect(html, "app name").toContain("seluna-Octo-Org");
    expect(formActionOf(html), "form action").toMatch(
      /^https:\/\/github\.com\/organizations\/Octo-Org\/settings\/apps\/new\?state=v1\.organization\.Octo-Org\.1700003600000\.[\w-]{22}\.[\w-]{43}$/,
    );
    expect(unescapeHtml(hiddenValue(html, "manifest")), "manifest field").toBe(
      expectedManifestJson(ORIGIN, "Octo-Org"),
    );
  });

  it("POST /setup/github sends GitHub no CSRF token and widens form-action to https://github.com on that page only", async () => {
    const review = await startGitHub(["personal"], ["octocat"], githubDeps(githubDouble()));

    expect(await review.clone().text(), "csrf field on the review page").not.toContain('name="csrf"');
    expect(review.headers.get("Content-Security-Policy"), "policy of the review page").toBe(
      await contentSecurityPolicy("github"),
    );
  });

  it.each([
    { name: "the step page", status: 200, respond: () => stepPage(githubDeps(githubDouble()), GITHUB_PATH) },
    {
      name: "the finish page",
      status: 200,
      respond: async () =>
        call(
          `${CALLBACK_PATH}?${form([
            ["code", FIXTURE_CODE],
            ["state", await githubState(PERSONAL_GITHUB)],
          ])}`,
        ),
    },
    {
      name: "a refused start",
      status: 400,
      respond: () => startGitHub(["personal"], ["a/b"], githubDeps(githubDouble())),
    },
  ])("the GitHub pages keep form-action 'self' except the review page: $name", async ({ respond, status }) => {
    const response = await respond();

    expect(response.status, "status").toBe(status);
    expect(response.headers.get("Content-Security-Policy"), "policy").toBe(await contentSecurityPolicy());
  });

  it.each(CSRF_FAILURES)(
    "POST /setup/github rejects a wrong CSRF token with 403: $name",
    async ({ tokens: tokensOf }) => {
      const csrf = (await tokensOf()).map((token): [string, string] => ["csrf", token]);

      const response = await postSignedIn(
        GITHUB_PATH,
        [...csrf, ["account_type", "personal"], ["account", "octocat"]],
        githubDeps(githubDouble()),
      );

      expect(response.status, "status").toBe(403);
      const html = await response.text();
      expectGitHubNoticeOnlyPage(html, "form-expired");
      expect(html, "manifest").not.toContain("manifest");
    },
  );

  it.each([
    { name: "a missing account type", types: [] as string[], accounts: ["octocat"] },
    { name: "a repeated account type", types: ["personal", "personal"], accounts: ["octocat"] },
    { name: "an unknown account type", types: ["user"], accounts: ["octocat"] },
    { name: "a missing account", types: ["personal"], accounts: [] as string[] },
    { name: "a repeated account", types: ["personal"], accounts: ["octocat", "octocat"] },
    { name: "an account with a slash", types: ["organization"], accounts: ["a/b"] },
    { name: "an account with a leading hyphen", types: ["personal"], accounts: ["-a"] },
    { name: "an account of 40 characters", types: ["personal"], accounts: ["a".repeat(40)] },
    { name: "an account with a trailing line feed", types: ["personal"], accounts: ["octocat\n"] },
  ])(
    "POST /setup/github answers 400 with the invalid account notice for a missing, repeated or invalid field: $name",
    async ({ types, accounts }) => {
      const response = await startGitHub(types, accounts, githubDeps(githubDouble()));

      expect(response.status, "status").toBe(400);
      const html = await response.text();
      expect(html, "notice").toContain(noticeText("github-invalid-account"));
      expect(html, "form").toMatch(/<form\b(?=[^>]*method="post")(?=[^>]*action="\/setup\/github")[^>]*>/);
      expect(html, "manifest").not.toContain('name="manifest"');
    },
  );

  it.each([
    { name: "all three Worker secrets", secrets: GITHUB_WORKER_SECRETS, text: TEXTS.en.githubWorkerSecrets },
    { name: "one Worker secret", secrets: { GITHUB_APP_ID: "12345" }, text: TEXTS.en.githubPartialWorkerSecrets },
  ])("POST /setup/github answers 409 while a GitHub Worker secret is set: $name", async ({ secrets, text }) => {
    const response = await startGitHub(["personal"], ["octocat"], githubSecretDeps(githubDouble(), secrets));

    expect(response.status, "status").toBe(409);
    const html = await response.text();
    expect(html, "explanation").toContain(escapeHtml(text));
    expect(html, "form").not.toContain("<form");
  });

  it("POST /setup/github answers 409 reset needed when the key check fails", async () => {
    await seedAppId(OTHER_SECRET, "12345");

    const response = await startGitHub(["personal"], ["octocat"], githubDeps(githubDouble()));

    expect(response.status, "status").toBe(409);
    const html = await response.text();
    expect(html, "reset text").toContain(escapeHtml(TEXTS.en.githubResetNeeded));
    expect(html, "form").not.toContain("<form");
  });

  it("POST /setup/github answers 503 with the unavailable notice when D1 fails", async () => {
    const deps = githubDeps(githubDouble(), { db: migrationTestDb() });

    const response = await startGitHub(["personal"], ["octocat"], deps);

    expect(response.status, "status").toBe(503);
    expectGitHubNoticeOnlyPage(await response.text(), "unavailable");
  });

  it.each([
    { name: "when it was issued", offsetMs: 0, session: undefined, valid: true },
    { name: "in its last millisecond", offsetMs: 3_599_999, session: undefined, valid: true },
    { name: "one hour after it was issued", offsetMs: 3_600_000, session: undefined, valid: false },
    { name: "for another session", offsetMs: 0, session: OTHER_SESSION, valid: false },
  ])(
    "the state of the review page binds the session, the account type and the account for one hour: $name",
    async ({ offsetMs, session, valid }) => {
      const response = await startGitHub(["organization"], ["Octo-Org"], githubDeps(githubDouble()));
      const state = new URL(formActionOf(await response.text())).searchParams.get("state") ?? "";

      const choice = await verifyGitHubState(
        await signingKeyFor(SECRET, "setup-github"),
        state,
        session ?? (await sessionToken()),
        new Date(NOW.getTime() + offsetMs),
      );

      expect(choice, "account choice").toEqual(valid ? { type: "organization", account: "Octo-Org" } : undefined);
    },
  );
});

/** The path of the callback with `fields` as its query. */
function callbackPath(fields: FormFields): string {
  return `${CALLBACK_PATH}?${form(fields)}`;
}

describe("handleSetup GitHub return", () => {
  it("GET /setup/github/callback answers 200 signed out with a finish form carrying code and state", async () => {
    const state = await githubState(PERSONAL_GITHUB);

    const response = await call(
      callbackPath([
        ["code", FIXTURE_CODE],
        ["state", state],
      ]),
    );

    expect(response.status, "status").toBe(200);
    expectFinishPage(await response.text(), FIXTURE_CODE, state);
  });

  it("GET /setup/github/callback answers the same finish form to a signed-in session", async () => {
    const state = await githubState(PERSONAL_GITHUB);

    const response = await call(
      callbackPath([
        ["code", FIXTURE_CODE],
        ["state", state],
      ]),
      { cookies: await signedInCookies() },
    );

    expect(response.status, "status").toBe(200);
    expectFinishPage(await response.text(), FIXTURE_CODE, state);
    expect(response.headers.getSetCookie(), "cookies").toEqual([]);
  });

  it("GET /setup/github/callback sets no cookie and calls neither GitHub nor D1", async () => {
    const github = githubDouble();
    const state = await githubState(PERSONAL_GITHUB);

    const response = await call(
      callbackPath([
        ["code", FIXTURE_CODE],
        ["state", state],
      ]),
      {},
      githubDeps(github, { db: unusedDb() }),
    );

    expect(response.status, "status").toBe(200);
    expect(await response.text(), "finish page").toContain('action="/setup/github/callback"');
    expect(response.headers.getSetCookie(), "cookies").toEqual([]);
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it("GET /setup/github/callback still sets the language cookie for ?lang=de", async () => {
    const state = await githubState(PERSONAL_GITHUB);

    const response = await call(
      callbackPath([
        ["code", FIXTURE_CODE],
        ["state", state],
        ["lang", "de"],
      ]),
    );

    expect(response.status, "status").toBe(200);
    expect(response.headers.getSetCookie().length, "number of cookies").toBe(1);
    expect(setCookiesOf(response, "seluna_lang").length, "language cookies").toBe(1);
  });

  const STATE = `v1.personal.octocat.1700003600000.${"A".repeat(22)}.${"B".repeat(43)}`;
  it.each<{ name: string; fields: FormFields }>([
    { name: "a missing code", fields: [["state", STATE]] },
    { name: "a missing state", fields: [["code", FIXTURE_CODE]] },
    {
      name: "a repeated code",
      fields: [
        ["code", FIXTURE_CODE],
        ["code", FIXTURE_CODE],
        ["state", STATE],
      ],
    },
    {
      name: "a repeated state",
      fields: [
        ["code", FIXTURE_CODE],
        ["state", STATE],
        ["state", STATE],
      ],
    },
    {
      name: "an empty code",
      fields: [
        ["code", ""],
        ["state", STATE],
      ],
    },
    {
      name: "a code of 101 characters",
      fields: [
        ["code", "a".repeat(101)],
        ["state", STATE],
      ],
    },
    {
      name: "a code that is dot dot",
      fields: [
        ["code", ".."],
        ["state", STATE],
      ],
    },
    {
      name: "a code with a slash",
      fields: [
        ["code", "a/b"],
        ["state", STATE],
      ],
    },
    {
      name: "a code with a backslash",
      fields: [
        ["code", "a\\b"],
        ["state", STATE],
      ],
    },
    {
      name: "a code with a question mark",
      fields: [
        ["code", "a?b"],
        ["state", STATE],
      ],
    },
    {
      name: "a code with a number sign",
      fields: [
        ["code", "a#b"],
        ["state", STATE],
      ],
    },
    {
      name: "a code with a space",
      fields: [
        ["code", "a b"],
        ["state", STATE],
      ],
    },
    {
      name: "a code with a plus sign",
      fields: [
        ["code", "a+b"],
        ["state", STATE],
      ],
    },
    {
      name: "a code with an equals sign",
      fields: [
        ["code", "a=b"],
        ["state", STATE],
      ],
    },
    {
      name: "a code with an umlaut",
      fields: [
        ["code", "ä"],
        ["state", STATE],
      ],
    },
    {
      name: "a code with a trailing line feed",
      fields: [
        ["code", "a\n"],
        ["state", STATE],
      ],
    },
    {
      name: "an empty state",
      fields: [
        ["code", FIXTURE_CODE],
        ["state", ""],
      ],
    },
    {
      name: "a state of another version",
      fields: [
        ["code", FIXTURE_CODE],
        ["state", STATE.replace("v1.", "v2.")],
      ],
    },
    {
      name: "a state with the type user",
      fields: [
        ["code", FIXTURE_CODE],
        ["state", STATE.replace(".personal.", ".user.")],
      ],
    },
    {
      name: "a state with a 21-character nonce",
      fields: [
        ["code", FIXTURE_CODE],
        ["state", STATE.replace("A".repeat(22), "A".repeat(21))],
      ],
    },
    {
      name: "a state with an expiry with a leading zero",
      fields: [
        ["code", FIXTURE_CODE],
        ["state", STATE.replace("1700003600000", "01700003600000")],
      ],
    },
  ])(
    "GET /setup/github/callback answers 400 with the invalid return notice for a missing, repeated or malformed code or state: $name",
    async ({ fields }) => {
      const github = githubDouble();

      const response = await call(callbackPath(fields), {}, githubDeps(github, { db: unusedDb() }));

      expect(response.status, "status").toBe(400);
      expectGitHubNoticeOnlyPage(await response.text(), "github-return-invalid");
      expect(response.headers.getSetCookie(), "cookies").toEqual([]);
      expect(github.requests, "GitHub requests").toEqual([]);
    },
  );

  it("GET /setup/github/callback answers 400 for a well-formed state followed by a line feed", async () => {
    const state = `${STATE}\n`;
    expect(state.charCodeAt(state.length - 1), "last code unit of the state").toBe(0x0a);

    const response = await call(
      callbackPath([
        ["code", FIXTURE_CODE],
        ["state", state],
      ]),
    );

    expect(response.status, "status").toBe(400);
    expectGitHubNoticeOnlyPage(await response.text(), "github-return-invalid");
  });
});

/** The fields of a finish form: no csrf field, `code`, then `state`. */
function finishFields(code: string, state: string): FormFields {
  return [
    ["code", code],
    ["state", state],
  ];
}

/** The created page of an app with a usable slug: saved text, install intro and the install link. */
function expectCreatedPage(html: string, slug: string): void {
  expect(html, "saved text").toContain(escapeHtml(TEXTS.en.githubCreated));
  expect(html, "install intro").toContain(escapeHtml(TEXTS.en.githubInstallIntro));
  expect(html, "install link").toContain(
    `<a href="https://github.com/apps/${slug}/installations/new">${escapeHtml(TEXTS.en.githubInstallLink)}</a>`,
  );
}

/** The created page of an app without a usable slug: saved text and the manual install text, no link to apps. */
function expectCreatedPageWithoutLink(html: string): void {
  expect(html, "saved text").toContain(escapeHtml(TEXTS.en.githubCreated));
  expect(html, "manual install text").toContain(escapeHtml(TEXTS.en.githubInstallManual));
  expect(html, "install link").not.toContain("https://github.com/apps/");
}

describe("handleSetup GitHub finish form", () => {
  it("POST /setup/github/callback stores app id, PKCS#8 key and webhook secret encrypted and links to the installation page", async () => {
    const github = githubDouble();
    const state = await githubState(PERSONAL_GITHUB);

    const response = await postSignedIn(CALLBACK_PATH, finishFields(FIXTURE_CODE, state), githubDeps(github));

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expectCreatedPage(html, "octoapp");
    expect(html, "webhook secret on the page").not.toContain(FIXTURE_WEBHOOK_SECRET);
    expect(html, "client secret on the page").not.toContain(FIXTURE_CLIENT_SECRET);
    expect(html, "private key on the page").not.toContain("BEGIN");
    expect(
      github.requests.map((request) => request.code),
      "converted codes",
    ).toEqual([FIXTURE_CODE]);
    const key = await keyFor(SECRET);
    expect(await readSecret(env.DB, key, "github_app_id"), "App ID").toEqual({ kind: "ok", value: "1" });
    expect(await readSecret(env.DB, key, "github_private_key"), "private key").toEqual({
      kind: "ok",
      value: FIXTURE_PKCS8,
    });
    expect(await readSecret(env.DB, key, "github_webhook_secret"), "webhook secret").toEqual({
      kind: "ok",
      value: FIXTURE_WEBHOOK_SECRET,
    });
    const stored = JSON.stringify((await env.DB.prepare("SELECT * FROM secrets").all()).results);
    expect(stored, "webhook secret in the table").not.toContain(FIXTURE_WEBHOOK_SECRET);
    expect(stored, "key in the table").not.toContain("BEGIN");
  });

  it("POST /setup/github/callback does not read a csrf field", async () => {
    const github = githubDouble();
    const state = await githubState(PERSONAL_GITHUB);

    const response = await postSignedIn(
      CALLBACK_PATH,
      [["csrf", "not-a-token"], ...finishFields(FIXTURE_CODE, state)],
      githubDeps(github),
    );

    expect(response.status, "status").toBe(200);
    expectCreatedPage(await response.text(), "octoapp");
  });

  it.each<{ name: string; fields: () => Promise<FormFields> }>([
    {
      name: "a state of another session",
      fields: async () => finishFields(FIXTURE_CODE, await githubState(PERSONAL_GITHUB, { session: OTHER_SESSION })),
    },
    {
      name: "an expired state",
      fields: async () =>
        finishFields(
          FIXTURE_CODE,
          await githubState(PERSONAL_GITHUB, { createdAt: new Date(NOW.getTime() - 3_600_000) }),
        ),
    },
    {
      name: "a state of another SELUNA_SECRET",
      fields: async () => finishFields(FIXTURE_CODE, await githubState(PERSONAL_GITHUB, { secret: OTHER_SECRET })),
    },
    {
      name: "a state with an altered MAC",
      fields: async () => {
        const state = await githubState(PERSONAL_GITHUB);
        return finishFields(FIXTURE_CODE, state.slice(0, -43) + withFirstCharacterChanged(state.slice(-43)));
      },
    },
    { name: "a missing state", fields: () => Promise.resolve([["code", FIXTURE_CODE]]) },
    {
      name: "two states",
      fields: async () => {
        const state = await githubState(PERSONAL_GITHUB);
        return [
          ["code", FIXTURE_CODE],
          ["state", state],
          ["state", state],
        ];
      },
    },
  ])(
    "POST /setup/github/callback rejects a state of another session, an expired or a missing state with 403 without calling GitHub: $name",
    async ({ fields }) => {
      const github = githubDouble();

      const response = await postSignedIn(CALLBACK_PATH, await fields(), githubDeps(github));

      expect(response.status, "status").toBe(403);
      expectGitHubNoticeOnlyPage(await response.text(), "github-state-invalid");
      expect(github.requests, "GitHub requests").toEqual([]);
      expect(await secretsCount(), "number of secrets rows").toBe(0);
    },
  );

  it.each([
    { name: "all three Worker secrets", secrets: GITHUB_WORKER_SECRETS, text: TEXTS.en.githubWorkerSecrets },
    { name: "one Worker secret", secrets: { GITHUB_APP_ID: "12345" }, text: TEXTS.en.githubPartialWorkerSecrets },
  ])(
    "POST /setup/github/callback answers 409 while a GitHub Worker secret is set, without calling GitHub: $name",
    async ({ secrets, text }) => {
      const github = githubDouble();
      const state = await githubState(PERSONAL_GITHUB);

      const response = await postSignedIn(
        CALLBACK_PATH,
        finishFields(FIXTURE_CODE, state),
        githubSecretDeps(github, secrets),
      );

      expect(response.status, "status").toBe(409);
      expect(await response.text(), "explanation").toContain(escapeHtml(text));
      expect(github.requests, "GitHub requests").toEqual([]);
      expect(await secretsCount(), "number of secrets rows").toBe(0);
    },
  );

  it("POST /setup/github/callback answers 409 reset needed before calling GitHub", async () => {
    await seedAppId(OTHER_SECRET, "12345");
    const github = githubDouble();
    const state = await githubState(PERSONAL_GITHUB);

    const response = await postSignedIn(CALLBACK_PATH, finishFields(FIXTURE_CODE, state), githubDeps(github));

    expect(response.status, "status").toBe(409);
    const html = await response.text();
    expect(html, "reset text").toContain(escapeHtml(TEXTS.en.githubResetNeeded));
    expect(html, "form").not.toContain("<form");
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it.each([
    { name: "404", answer: githubJsonAnswer(404, GITHUB_FIXTURES.notFound) },
    { name: "422", answer: githubJsonAnswer(422, GITHUB_FIXTURES.validationFailed) },
  ])("POST /setup/github/callback answers 400 code rejected for GitHub's $name", async ({ answer }) => {
    const github = githubDouble(answer);
    const state = await githubState(PERSONAL_GITHUB);

    const response = await postSignedIn(CALLBACK_PATH, finishFields(FIXTURE_CODE, state), githubDeps(github));

    expect(response.status, "status").toBe(400);
    const html = await response.text();
    expectGitHubNoticeOnlyPage(html, "github-code-rejected");
    expect(html, "GitHub's message").not.toContain("Validation Failed");
    expect(await secretsCount(), "number of secrets rows").toBe(0);
  });

  it("POST /setup/github/callback offers the finish form again with 502 when GitHub is unavailable", async () => {
    const github = githubDouble(GITHUB_REJECTED);
    const state = await githubState(PERSONAL_GITHUB);

    const response = await postSignedIn(CALLBACK_PATH, finishFields(FIXTURE_CODE, state), githubDeps(github));

    expect(response.status, "status").toBe(502);
    const html = await response.text();
    expect(html, "notice").toContain(noticeText("github-unavailable"));
    expectFinishPage(html, FIXTURE_CODE, state);
    expect(await secretsCount(), "number of secrets rows").toBe(0);
  });

  it.each<{ name: string; answer: GitHubAnswer }>([
    { name: "an answer that is not JSON", answer: { kind: "raw", status: 201, body: "not json" } },
    {
      name: "a webhook secret that is null",
      answer: githubJsonAnswer(201, conversionAnswer({ webhook_secret: null })),
    },
    { name: "a key that does not import", answer: githubJsonAnswer(201, conversionAnswer({ pem: "not a key" })) },
  ])(
    "POST /setup/github/callback answers 502 answer invalid and stores nothing for a malformed answer or a key that does not import: $name",
    async ({ answer }) => {
      const github = githubDouble(answer);
      const state = await githubState(PERSONAL_GITHUB);

      const response = await postSignedIn(CALLBACK_PATH, finishFields(FIXTURE_CODE, state), githubDeps(github));

      expect(response.status, "status").toBe(502);
      const html = await response.text();
      expectGitHubNoticeOnlyPage(html, "github-answer-invalid");
      expect(html, "install link").not.toContain("https://github.com/apps/");
      expect(await secretsCount(), "number of secrets rows").toBe(0);
      expect(await keyCheckCount(), "number of key check rows").toBe(0);
    },
  );

  it("POST /setup/github/callback answers 503 store failed when saving fails after the conversion", async () => {
    const github = githubDouble();
    const state = await githubState(PERSONAL_GITHUB);
    // The credential write is the only batch of three or more statements; reading a credential batches two.
    const db: D1Database = {
      prepare: (query) => env.DB.prepare(query),
      exec: (query) => env.DB.exec(query),
      withSession: (constraintOrBookmark) => env.DB.withSession(constraintOrBookmark),
      dump: () => Promise.reject(new Error("dump is deprecated and not forwarded")),
      batch: <T = unknown>(statements: D1PreparedStatement[]) =>
        statements.length >= 3 ? Promise.reject(new Error("write failed")) : env.DB.batch<T>(statements),
    };

    const response = await postSignedIn(CALLBACK_PATH, finishFields(FIXTURE_CODE, state), githubDeps(github, { db }));

    expect(response.status, "status").toBe(503);
    const html = await response.text();
    expectGitHubNoticeOnlyPage(html, "github-store-failed");
    expect(html, "install link").not.toContain("https://github.com/apps/");
    expect(github.requests.length, "number of conversions").toBe(1);
    expect(await secretsCount(), "number of secrets rows").toBe(0);
  });

  it.each([
    { name: "no slug", slug: undefined },
    { name: "a slug with uppercase letters", slug: "Octo-App" },
    { name: "a slug with a slash", slug: "a/b" },
  ])("the created page tells how to install the app when the answer has no usable slug: $name", async ({ slug }) => {
    const github = githubDouble(githubJsonAnswer(201, conversionAnswer({ slug })));
    const state = await githubState(PERSONAL_GITHUB);

    const response = await postSignedIn(CALLBACK_PATH, finishFields(FIXTURE_CODE, state), githubDeps(github));

    expect(response.status, "status").toBe(200);
    expectCreatedPageWithoutLink(await response.text());
    expect(await secretsCount(), "number of secrets rows").toBe(3);
  });

  it.each([
    {
      name: "an app of the user github for a personal octocat",
      choice: { type: "personal", account: "octocat" } as const,
      answer: githubJsonAnswer(201, conversionAnswer()),
    },
    {
      name: "an app of the user github for the organization github",
      choice: { type: "organization", account: "github" } as const,
      answer: githubJsonAnswer(201, conversionAnswer()),
    },
    {
      name: "an app of the organization github for the personal account github",
      choice: { type: "personal", account: "github" } as const,
      answer: githubJsonAnswer(201, conversionOwnedBy("github", "Organization")),
    },
  ])(
    "POST /setup/github/callback answers 403 owner mismatch, stores nothing and shows no install link for an app of another account: $name",
    async ({ choice, answer }) => {
      const github = githubDouble(answer);
      const state = await githubState(choice);

      const response = await postSignedIn(CALLBACK_PATH, finishFields(FIXTURE_CODE, state), githubDeps(github));

      expect(response.status, "status").toBe(403);
      const html = await response.text();
      expectGitHubNoticeOnlyPage(html, "github-owner-mismatch");
      expect(html, "install link").not.toContain("https://github.com/apps/");
      expect(await secretsCount(), "number of secrets rows").toBe(0);
      expect(await keyCheckCount(), "number of key check rows").toBe(0);
    },
  );
});

describe("handleSetup GitHub forms: bodies, sign-in and failures", () => {
  const unreadable = (): ReadableStream<Uint8Array> =>
    new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("connection lost"));
      },
    });

  it.each([
    { method: "GET", path: GITHUB_PATH },
    { method: "POST", path: GITHUB_PATH },
    { method: "POST", path: CALLBACK_PATH },
  ])("$method $path signed out answers the login page and calls nothing", async ({ method, path }) => {
    const github = githubDouble();

    const response = await call(path, { method }, githubDeps(github, { db: unusedDb() }));

    expect(response.status, "status").toBe(200);
    expectLoginPage(await response.text());
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it.each([GITHUB_PATH, CALLBACK_PATH])(
    "POST %s answers a body over 1 MiB with 413 before any other check",
    async (path) => {
      const github = githubDouble();

      const response = await call(
        path,
        { method: "POST", cookies: await signedInCookies(), body: "a".repeat(MAX_BODY_BYTES + 1) },
        githubDeps(github),
      );

      expect(response.status, "status").toBe(413);
      expect(await response.text(), "body").toBe("");
      expect(github.requests, "GitHub requests").toEqual([]);
    },
  );

  it.each([GITHUB_PATH, CALLBACK_PATH])(
    "POST %s answers an unreadable body with 400 before any other check",
    async (path) => {
      const github = githubDouble();

      const response = await call(
        path,
        { method: "POST", cookies: await signedInCookies(), body: unreadable() },
        githubDeps(github),
      );

      expect(response.status, "status").toBe(400);
      expect(await response.text(), "body").toBe("");
      expect(github.requests, "GitHub requests").toEqual([]);
    },
  );

  it("POST /setup/github/callback answers 503 with the unavailable notice when D1 fails before the conversion", async () => {
    const github = githubDouble();
    const state = await githubState(PERSONAL_GITHUB);

    const response = await postSignedIn(
      CALLBACK_PATH,
      finishFields(FIXTURE_CODE, state),
      githubDeps(github, { db: migrationTestDb() }),
    );

    expect(response.status, "status").toBe(503);
    const html = await response.text();
    expectGitHubNoticeOnlyPage(html, "unavailable");
    expect(html.toLowerCase(), "error text").not.toContain("no such table");
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it.each([
    { name: "a missing code", codes: [] as string[] },
    { name: "a repeated code", codes: [FIXTURE_CODE, FIXTURE_CODE] },
    { name: "a code with a slash", codes: ["a/b"] },
  ])("POST /setup/github/callback answers 400 with the invalid return notice for $name", async ({ codes }) => {
    const github = githubDouble();
    const state = await githubState(PERSONAL_GITHUB);

    const response = await postSignedIn(
      CALLBACK_PATH,
      [...codes.map((code): [string, string] => ["code", code]), ["state", state]],
      githubDeps(github),
    );

    expect(response.status, "status").toBe(400);
    expectGitHubNoticeOnlyPage(await response.text(), "github-return-invalid");
    expect(github.requests, "GitHub requests").toEqual([]);
  });
});

const VALID_SETTINGS_FIELDS: readonly (readonly [string, string])[] = [
  ["notification_language", "de"],
  ["time_zone", "Europe/Berlin"],
  ["quiet_hours", "on"],
  ["quiet_start", "22:00"],
  ["quiet_end", "07:00"],
  ["rule_pull_request_opened", "on"],
  ["rule_pull_request_ready_for_review", "on"],
  ["rule_pull_request_review_requested", "on"],
  ["rule_ci_failed_default_branch", "on"],
  ["rule_ci_failed_pull_request", "on"],
  ["rule_code_scanning_alert", "on"],
  ["rule_secret_scanning_alert", "on"],
  ["update_notice", "on"],
];

/** The settings `VALID_SETTINGS_FIELDS` submit: every rule on but the Dependabot alert. */
const SUBMITTED_SETTINGS: NotificationSettings = {
  language: "de",
  timeZone: "Europe/Berlin",
  quietHours: { start: "22:00", end: "07:00" },
  rules: { ...DEFAULT_SETTINGS.rules, dependabot_alert: false },
  updateNotice: true,
};

/** The fields of a settings form with a valid session-bound token and `extra` appended to the valid fields. */
async function settingsFormFields(extra: FormFields = []): Promise<FormFields> {
  return [["csrf", await validCsrf()], ...VALID_SETTINGS_FIELDS, ...extra];
}

async function tokenCacheCount(): Promise<unknown> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM token_cache").first();
  return row?.total;
}

async function seedTokenCache(): Promise<void> {
  await env.DB.prepare("INSERT INTO token_cache (installation_id, iv, ciphertext, expires_at) VALUES (1, ?1, 'x', 1)")
    .bind("AAAAAAAAAAAAAAAA")
    .run();
}

async function putMeta(key: string, value: string): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)").bind(key, value).run();
}

/** The first `<input>` tag of `html` with the given name, or an empty text. */
function inputTagOf(html: string, name: string): string {
  return new RegExp(`<input\\b(?=[^>]*name="${name}")[^>]*>`).exec(html)?.[0] ?? "";
}

describe("handleSetup status page", () => {
  it("GET /setup shows version, chat, app and last delivery", async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', '5001001')").run();
    await seedAppId(SECRET, "12345");
    await putMeta("github_app_slug", "12345:seluna-demo");
    await putMeta("last_delivery", "1792240440000");

    const response = await stepPage(depsAt(), "/setup");

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expectStartPage(html);
    expect(html, "status heading").toContain(escapeHtml(TEXTS.en.statusHeading));
    expect(html, "version").toContain("0.0.0-test");
    expect(html, "chat line").toMatch(new RegExp(`${escapeRegExp(TEXTS.en.telegramChatLabel)}[\\s\\S]{0,40}5001001`));
    expect(html, "app link").toContain('<a href="https://github.com/apps/seluna-demo">seluna-demo</a>');
    expect(html, "App ID").toContain(`(${escapeHtml(TEXTS.en.appIdLabel)} 12345)`);
    expect(html, "last delivery").toContain("2026-10-17 12:34 (UTC)");
    expect(html, "reset form").not.toContain('action="/setup/reset"');
    expect(html, "settings form").toContain('action="/setup/settings"');
  });

  it("GET /setup shows the saved settings as selected", async () => {
    await writeNotificationSettings(env.DB, SUBMITTED_SETTINGS);

    const response = await stepPage(depsAt(), "/setup");

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "language").toContain('<option value="de" selected>');
    expect(html, "time zone").toContain('<option value="Europe/Berlin" selected>');
    expect(inputTagOf(html, "quiet_hours"), "quiet hours").toMatch(/\bchecked\b/);
    expect(inputTagOf(html, "quiet_start"), "quiet start").toContain('value="22:00"');
    expect(inputTagOf(html, "quiet_end"), "quiet end").toContain('value="07:00"');
    expect(inputTagOf(html, "rule_dependabot_alert"), "disabled rule").not.toMatch(/\bchecked\b/);
    expect(inputTagOf(html, "rule_ci_failed_pull_request"), "enabled rule").toMatch(/\bchecked\b/);
  });

  it("GET /setup answers 503 with the unavailable notice when D1 fails", async () => {
    const response = await stepPage(depsAt(NOW.getTime(), { db: migrationTestDb() }), "/setup");

    expect(response.status, "status").toBe(503);
    const html = await response.text();
    expectStartPage(html);
    expect(html, "unavailable notice").toContain(noticeText("unavailable"));
    expect(html, "Telegram link").toContain(`<a href="/setup/telegram">${escapeHtml(TEXTS.en.telegramHeading)}</a>`);
    expect(html, "settings form").not.toContain('action="/setup/settings"');
    expect(html.toLowerCase(), "error text").not.toContain("no such table");
  });
});

describe("handleSetup settings form", () => {
  it("POST /setup/settings stores the settings and answers 303 to /setup", async () => {
    const deps = depsAt();

    const response = await postSignedIn(SETTINGS_PATH, await settingsFormFields(), deps);

    expect(response.status, "status").toBe(303);
    expect(response.headers.get("Location"), "Location").toBe("/setup");
    expect(await readNotificationSettings(env.DB), "stored settings").toEqual(SUBMITTED_SETTINGS);
  });

  it("POST /setup/settings answers 400 with the settings invalid notice and stores nothing", async () => {
    const fields: FormFields = [
      ["csrf", await validCsrf()],
      ...VALID_SETTINGS_FIELDS.filter(([name]) => name !== "notification_language"),
      ["notification_language", "fr"],
    ];

    const response = await postSignedIn(SETTINGS_PATH, fields, depsAt());

    expect(response.status, "status").toBe(400);
    const html = await response.text();
    expect(html, "notice").toContain(noticeText("settings-invalid"));
    expect(html, "status heading").toContain(escapeHtml(TEXTS.en.statusHeading));
    expect(html, "settings form").toContain('action="/setup/settings"');
    expect(await settingsRowCount(), "number of settings rows").toBe(0);
  });

  it("POST /setup/settings answers 503 with the unavailable notice when D1 fails", async () => {
    const response = await postSignedIn(
      SETTINGS_PATH,
      await settingsFormFields(),
      depsAt(NOW.getTime(), { db: migrationTestDb() }),
    );

    expect(response.status, "status").toBe(503);
    const html = await response.text();
    expect(html, "unavailable notice").toContain(noticeText("unavailable"));
    expect(html.toLowerCase(), "error text").not.toContain("no such table");
  });
});

describe("handleSetup reset form", () => {
  it("GET /setup shows the reset form when the key check was sealed under another SELUNA_SECRET", async () => {
    await seedAppId(OTHER_SECRET, "12345");

    const response = await stepPage(depsAt(), "/setup");

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "reset heading").toContain(escapeHtml(TEXTS.en.resetHeading));
    expect(html, "reset text").toContain(escapeHtml(TEXTS.en.resetText));
    expect(html, "reset button").toContain(escapeHtml(TEXTS.en.resetButton));
    expect(html, "reset form").toMatch(/<form\b(?=[^>]*method="post")(?=[^>]*action="\/setup\/reset")[^>]*>/);
    const resetForm = html.slice(html.indexOf('action="/setup/reset"'));
    expect(resetForm, "session-bound csrf field").toContain(`name="csrf" value="${await validCsrf()}"`);
    expect(html, "cannot be read line").toContain(escapeHtml(TEXTS.en.cannotBeRead));
  });

  it("POST /setup/reset clears the credentials and answers 303 to /setup/github", async () => {
    await seedAppId(OTHER_SECRET, "12345");
    await seedTokenCache();
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', '5001001')").run();
    await putMeta("last_delivery", "1792240440000");

    const response = await postSignedIn(RESET_PATH, [["csrf", await validCsrf()]], depsAt());

    expect(response.status, "status").toBe(303);
    expect(response.headers.get("Location"), "Location").toBe("/setup/github");
    expect(await secretsCount(), "number of secrets rows").toBe(0);
    expect(await keyCheckCount(), "number of key check rows").toBe(0);
    expect(await tokenCacheCount(), "number of token_cache rows").toBe(0);
    expect(await savedChat(), "saved chat").toBe("5001001");
    const delivery = await env.DB.prepare("SELECT value FROM meta WHERE key = 'last_delivery'").first();
    expect(delivery?.value, "last delivery").toBe("1792240440000");
  });

  it("GET /setup/github shows the form after a reset", async () => {
    await seedAppId(OTHER_SECRET, "12345");
    await postSignedIn(RESET_PATH, [["csrf", await validCsrf()]], depsAt());

    const response = await stepPage(githubDeps(githubDouble()), GITHUB_PATH);

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "account form").toMatch(/<form\b(?=[^>]*method="post")(?=[^>]*action="\/setup\/github")[^>]*>/);
    expect(html, "reset text").not.toContain(escapeHtml(TEXTS.en.githubResetNeeded));
  });

  it("POST /setup/reset answers 409 and deletes nothing when no reset is needed", async () => {
    await seedAppId(SECRET, "12345");
    await seedTokenCache();

    const response = await postSignedIn(RESET_PATH, [["csrf", await validCsrf()]], depsAt());

    expect(response.status, "status").toBe(409);
    expect(await response.text(), "notice").toContain(noticeText("reset-not-needed"));
    expect(await secretsCount(), "number of secrets rows").toBe(1);
    expect(await keyCheckCount(), "number of key check rows").toBe(1);
    expect(await tokenCacheCount(), "number of token_cache rows").toBe(1);
  });

  it("POST /setup/reset answers 403 with a token of another session", async () => {
    await seedAppId(OTHER_SECRET, "12345");
    const token = await sessionCsrfToken(await sessionToken(new Date(NOW.getTime() - 3_600_000)));

    const response = await postSignedIn(RESET_PATH, [["csrf", token]], depsAt());

    expect(response.status, "status").toBe(403);
    expect(await response.text(), "notice").toContain(noticeText("form-expired"));
    expect(await secretsCount(), "number of secrets rows").toBe(1);
  });

  it("POST /setup/reset answers 503 with the unavailable notice when D1 fails", async () => {
    const response = await postSignedIn(
      RESET_PATH,
      [["csrf", await validCsrf()]],
      depsAt(NOW.getTime(), { db: migrationTestDb() }),
    );

    expect(response.status, "status").toBe(503);
    const html = await response.text();
    expect(html, "unavailable notice").toContain(noticeText("unavailable"));
    expect(html.toLowerCase(), "error text").not.toContain("no such table");
  });
});

describe("handleSetup GitHub start with credentials but no key check", () => {
  it("POST /setup/github answers 409 reset needed when secrets holds a row but no key check", async () => {
    await seedAppId(SECRET, "12345");
    await env.DB.prepare("DELETE FROM meta WHERE key = 'key_check'").run();
    const github = githubDouble();

    const response = await startGitHub(["personal"], ["github"], githubDeps(github));

    expect(response.status, "status").toBe(409);
    expect(await response.text(), "reset text").toContain(escapeHtml(TEXTS.en.githubResetNeeded));
    expect(github.requests, "GitHub requests").toEqual([]);
  });
});

describe("handleSetup settings and reset forms: protection", () => {
  const PATHS = [SETTINGS_PATH, RESET_PATH];

  /** The fields of a form to `path` with the given csrf `tokens`: the valid settings fields for the settings form. */
  function fieldsFor(path: string, tokens: readonly string[]): FormFields {
    const csrf = tokens.map((token): [string, string] => ["csrf", token]);
    return path === SETTINGS_PATH ? [...csrf, ...VALID_SETTINGS_FIELDS] : csrf;
  }

  it.each(
    PATHS.flatMap((path) => CSRF_FAILURES.map((failure) => ({ path, token: failure.name, tokens: failure.tokens }))),
  )("POST $path rejects $token with 403", async ({ path, tokens: tokensOf }) => {
    await seedAppId(OTHER_SECRET, "12345");

    const response = await postSignedIn(path, fieldsFor(path, await tokensOf()), depsAt());

    expect(response.status, "status").toBe(403);
    const html = await response.text();
    expectStartPage(html);
    expect(html, "notice").toContain(noticeText("form-expired"));
    expect(html, "settings form").not.toContain('action="/setup/settings"');
    expect(await settingsRowCount(), "number of settings rows").toBe(0);
    expect(await secretsCount(), "number of secrets rows").toBe(1);
  });

  it.each(PATHS)("POST %s answers a body over 1 MiB with 413", async (path) => {
    await seedAppId(OTHER_SECRET, "12345");

    const response = await call(path, {
      method: "POST",
      cookies: await signedInCookies(),
      body: "a".repeat(MAX_BODY_BYTES + 1),
    });

    expect(response.status, "status").toBe(413);
    expect(await response.text(), "body").toBe("");
    expect(await secretsCount(), "number of secrets rows").toBe(1);
  });
});
