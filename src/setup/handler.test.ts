import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BODY_BYTES } from "../body";
import { LOGIN_ATTEMPTS_META_KEY, LOGIN_LOCK_MS } from "../store/login-attempts";
import { readSecret, writeSecret, writeSecrets } from "../store/secrets";
import {
  DELIVERY_CHANNEL_SETTING,
  readNotificationSettings,
  readSetting,
  TELEGRAM_CHAT_ID_SETTING,
  writeNotificationSettings,
  writeSetting,
} from "../store/settings";
import type { ChannelList } from "../channels/channel";
import { TELEGRAM_CHANNEL } from "../channels/telegram";
import { MAX_TELEGRAM_RESPONSE_BYTES } from "../telegram";
import { DEFAULT_SETTINGS } from "../settings";
import type { NotificationSettings } from "../settings";
import { CSRF_COOKIE, csrfTokenFor, sessionCsrfTokenFor } from "./csrf";
import { createChatProof } from "./chat-proof";
import { verifyGitHubState } from "./github-state";
import { handleSetup, isSetupPath } from "./handler";
import type { SetupDeps } from "./handler";
import { contentSecurityPolicy, escapeHtml, STYLE } from "./pages";
import { createSessionToken, SESSION_COOKIE, SESSION_LIFETIME_MS } from "./session";
import { RESET_PATH, SETTINGS_PATH } from "./settings-form";
import { TEXTS } from "./texts";
import type { Notice } from "./texts";
import { testChannel } from "../../test/channel";
import type { TestChannel } from "../../test/channel";
import { applyMigrations, migrationTestDb, schemaOnlyDb, unusedDb } from "../../test/d1";
import {
  appBody,
  conversionAnswer,
  conversionOwnedBy,
  expectedManifestJson,
  FIXTURE_CLIENT_SECRET,
  FIXTURE_CODE,
  FIXTURE_PKCS8,
  FIXTURE_WEBHOOK_SECRET,
  FIXTURES as GITHUB_FIXTURES,
  FIXTURE_PEM,
  FULL_EVENTS,
  FULL_PERMISSIONS,
  githubApiDouble,
  githubDouble,
  installationEntry,
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

/** Asserts that `html` carries no database error text. */
function expectNoErrorText(html: string): void {
  const lowered = html.toLowerCase();
  expect(lowered, "no such table").not.toContain("no such table");
  expect(lowered, "D1_ERROR").not.toContain("d1_error");
  expect(lowered, "sqlite").not.toContain("sqlite");
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

/** The page without its style element, whose CSS names `aria-current` and `.steps`. */
function markupOf(html: string): string {
  return html.replace(`<style>${STYLE}</style>`, "");
}

/** The step navigation of the GitHub pages in English: GitHub App is the current item, the others are links. */
function expectGitHubStepNavigation(html: string): void {
  const texts = TEXTS.en;
  expect(html, "step navigation").toContain(
    `<nav class="steps" aria-label="${escapeHtml(texts.stepsLabel)}">` +
      `<a href="/setup">${escapeHtml(texts.startPageLink)}</a> | ` +
      `<a href="/setup/telegram">${escapeHtml(texts.telegramHeading)}</a> | ` +
      `<span aria-current="page">${escapeHtml(texts.githubHeading)}</span></nav>`,
  );
  expect(markupOf(html).match(/aria-current/g), "aria-current attributes").toHaveLength(1);
}

/** Asserts that `html` carries no step navigation and no `aria-current` anywhere. */
function expectNoStepNavigation(html: string): void {
  const markup = markupOf(html);
  expect(markup, "class steps anywhere in the markup").not.toContain('class="steps"');
  expect(markup, "aria-current anywhere in the markup").not.toContain("aria-current");
}

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

  it.each([{ path: "/setup" }, { path: "/setup/telegram" }])(
    "handleSetup answers GET $path without a session with the login page and no step navigation",
    async ({ path }) => {
      const response = await call(path);

      expect(response.status, "status").toBe(200);
      const html = await response.text();
      expectLoginPage(html);
      expectNoStepNavigation(html);
    },
  );

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

  it("handleSetup answers a login with 503 and the migrations-missing notice when the database has no tables", async () => {
    const response = await login(SECRET, depsAt(NOW.getTime(), { db: migrationTestDb() }));

    expect(response.status, "status").toBe(503);
    const html = await response.text();
    expectLoginPage(html);
    expect(html, "migrations-missing notice").toContain(noticeText("migrations-missing"));
    expect(html, "unavailable notice").not.toContain(noticeText("unavailable"));
    expectNoErrorText(html);
    expect(setCookiesOf(response, SESSION_COOKIE), "session cookies").toEqual([]);
  });

  it("handleSetup answers a wrong secret with the migrations-missing notice when the database has no tables", async () => {
    const response = await login("wrong", depsAt(NOW.getTime(), { db: migrationTestDb() }));

    expect(response.status, "status").toBe(503);
    const html = await response.text();
    expectLoginPage(html);
    expect(html, "migrations-missing notice").toContain(noticeText("migrations-missing"));
    expect(html, "wrong-secret notice").not.toContain(noticeText("wrong-secret"));
    expectNoErrorText(html);
    expect(setCookiesOf(response, SESSION_COOKIE), "session cookies").toEqual([]);
  });

  it("handleSetup shows the migrations-missing notice in German", async () => {
    const init = await loginInit();

    const response = await call(
      "/setup/login",
      { ...init, headers: { "accept-language": "de" } },
      depsAt(NOW.getTime(), { db: migrationTestDb() }),
    );

    expect(response.status, "status").toBe(503);
    const html = await response.text();
    expect(html, "German notice").toContain(noticeText("migrations-missing", "de"));
    expect(html, "English notice").not.toContain(noticeText("migrations-missing"));
  });

  it("handleSetup answers a login with 503 and the unavailable notice when D1 fails with every table present", async () => {
    const response = await login(SECRET, depsAt(NOW.getTime(), { db: schemaOnlyDb(env.DB) }));

    expect(response.status, "status").toBe(503);
    const html = await response.text();
    expectLoginPage(html);
    expect(html, "unavailable notice").toContain(noticeText("unavailable"));
    expect(html, "migrations-missing notice").not.toContain(noticeText("migrations-missing"));
    expect(setCookiesOf(response, SESSION_COOKIE), "session cookies").toEqual([]);
  });

  it("handleSetup answers a login with 503 and the unavailable notice when the schema check fails too", async () => {
    const response = await login(SECRET, depsAt(NOW.getTime(), { db: unusedDb() }));

    expect(response.status, "status").toBe(503);
    const html = await response.text();
    expectLoginPage(html);
    expect(html, "unavailable notice").toContain(noticeText("unavailable"));
    expect(html, "migrations-missing notice").not.toContain(noticeText("migrations-missing"));
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
    { method: "POST", path: "/setup/telegram/token" },
    { method: "POST", path: "/setup/telegram/token/remove" },
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
  it("handleSetup shows the token form and calls no Telegram API when no bot token is available", async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', '-1001234567890')").run();
    const telegram = telegramDouble();

    const response = await stepPage(telegramDeps(telegram, { env: { SELUNA_SECRET: SECRET } }));

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "token heading").toContain(`<h2>${escapeHtml(TEXTS.en.telegramTokenHeading)}</h2>`);
    expect(html, "token intro").toContain(escapeHtml(TEXTS.en.telegramTokenIntro));
    expect(html, "token form").toMatch(/<form\b(?=[^>]*method="post")(?=[^>]*action="\/setup\/telegram\/token")[^>]*>/);
    expect(hiddenValue(html, "csrf"), "session-bound CSRF token").toBe(await validCsrf());
    const tokenInput = /<input\b(?=[^>]*name="token")[^>]*>/.exec(html)?.[0] ?? "";
    expect(tokenInput, "masked field").toContain('type="password"');
    expect(tokenInput, "autocomplete").toContain('autocomplete="off"');
    expect(tokenInput, "value attribute").not.toMatch(/\svalue=/);
    expect(html, "save button").toContain(escapeHtml(TEXTS.en.telegramTokenSaveButton));
    expect(html, "saved chat line stays").toMatch(
      new RegExp(`${escapeRegExp(escapeHtml(TEXTS.en.telegramSavedChat))}[^0-9-]{0,40}-1001234567890`),
    );
    expect(radioValues(html), "radio inputs").toEqual([]);
    expect(html, "chat form").not.toContain('action="/setup/telegram"');
    expect(html, "search link").not.toContain(escapeHtml(TEXTS.en.telegramSearchLink));
    expect(html, "remove form").not.toContain("/setup/telegram/token/remove");
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

const TOKEN_PATH = "/setup/telegram/token";
const REMOVE_PATH = "/setup/telegram/token/remove";
const NEW_TOKEN = "555555555:CCH-new_throwaway_token0123456789abcdefg";
const SAVED_TOKEN = "777777777:DDH-saved_throwaway_token0123456789abcde";
const TOKEN_ONLY_ENV = { SELUNA_SECRET: SECRET };
const TOKEN_CHAT_ENV = { SELUNA_SECRET: SECRET, TELEGRAM_CHAT_ID: CHAT_SECRET_VALUE };
const WORKER_TOKEN_ENV = { SELUNA_SECRET: SECRET, TELEGRAM_BOT_TOKEN: BOT_TOKEN };

/** Dependencies without the Worker secret `TELEGRAM_BOT_TOKEN`: the token comes from the setup. */
function savedTokenDeps(telegram: TelegramDouble, overrides: Partial<SetupDeps> = {}): SetupDeps {
  return depsAt(NOW.getTime(), { env: TOKEN_ONLY_ENV, fetch: telegram.fetch, ...overrides });
}

async function saveBotToken(value: string, secret: string = SECRET): Promise<void> {
  const result = await writeSecret(env.DB, await keyFor(secret), "telegram_bot_token", value);
  expect(result, "seeding the saved bot token").toEqual({ kind: "ok" });
}

/** The saved bot token, or `undefined` when none is saved or it cannot be read. */
async function savedBotToken(): Promise<string | undefined> {
  const result = await readSecret(env.DB, await keyFor(SECRET), "telegram_bot_token");
  return result.kind === "ok" ? result.value : undefined;
}

/** Replaces the ciphertext of the saved bot token row by an altered one, leaving the key check value in place. */
async function damageBotTokenRow(): Promise<void> {
  const row = await env.DB.prepare("SELECT ciphertext FROM secrets WHERE key = 'telegram_bot_token'").first();
  const ciphertext = typeof row?.ciphertext === "string" ? row.ciphertext : "";
  await env.DB.prepare("UPDATE secrets SET ciphertext = ?1 WHERE key = 'telegram_bot_token'")
    .bind(withFirstCharacterChanged(ciphertext))
    .run();
}

async function saveGitHubCredentials(secret: string = SECRET): Promise<void> {
  const result = await writeSecrets(env.DB, await keyFor(secret), {
    github_app_id: "12345",
    github_private_key: "private-key-text",
    github_webhook_secret: "webhook-secret-text",
  });
  expect(result, "seeding the GitHub credentials").toEqual({ kind: "ok" });
}

async function gitHubAppId(): Promise<unknown> {
  return readSecret(env.DB, await keyFor(SECRET), "github_app_id");
}

/** Every row of every table, as one text: for a scan for a value that must not be stored in plain text. */
async function databaseText(): Promise<string> {
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  ).all();
  const names = tables.results.map((table) => String(table.name));
  const dumps = await Promise.all(
    names.map(async (name) => JSON.stringify((await env.DB.prepare(`SELECT * FROM "${name}"`).all()).results)),
  );
  return dumps.join("\n");
}

async function storedKeyCheckRow(): Promise<unknown> {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'key_check'").first();
  return row?.value;
}

/** The fields of a token form: a valid session-bound token and one `token` field per entry of `tokens`. */
async function tokenFields(tokens: readonly string[]): Promise<FormFields> {
  return [["csrf", await validCsrf()], ...tokens.map((token): [string, string] => ["token", token])];
}

async function saveToken(tokens: readonly string[], deps: SetupDeps): Promise<Response> {
  return postSignedIn(TOKEN_PATH, await tokenFields(tokens), deps);
}

async function removeToken(deps: SetupDeps): Promise<Response> {
  return postSignedIn(REMOVE_PATH, [["csrf", await validCsrf()]], deps);
}

/** A token form whose body is `csrf=…` followed by `rest` as written (for encodings `URLSearchParams` would not produce). */
async function rawTokenForm(rest: string, deps: SetupDeps): Promise<Response> {
  return call(
    TOKEN_PATH,
    {
      method: "POST",
      cookies: await signedInCookies(),
      body: `csrf=${encodeURIComponent(await validCsrf())}${rest}`,
    },
    deps,
  );
}

const TOKEN_FORMS: readonly { readonly form: string; readonly path: string }[] = [
  { form: "the token form", path: TOKEN_PATH },
  { form: "the remove form", path: REMOVE_PATH },
];

async function postToForm(path: string, deps: SetupDeps): Promise<Response> {
  return path === TOKEN_PATH ? saveToken([NEW_TOKEN], deps) : removeToken(deps);
}

describe("handleSetup Telegram step with a saved bot token", () => {
  it("handleSetup shows the saved token with Change and Remove and searches chats with it", async () => {
    await saveBotToken(SAVED_TOKEN);
    const telegram = telegramDouble();

    const response = await stepPage(savedTokenDeps(telegram));

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "saved text").toContain(`<p>${escapeHtml(TEXTS.en.telegramTokenSaved)}</p>`);
    expect(html, "Change token").toContain(`<summary>${escapeHtml(TEXTS.en.telegramTokenChange)}</summary>`);
    expect(html, "closed disclosure").not.toMatch(/<details\b[^>]*\bopen\b/);
    expect(html, "token form").toContain('action="/setup/telegram/token"');
    expect(html, "remove form").toContain('action="/setup/telegram/token/remove"');
    expect(html, "Remove token").toContain(escapeHtml(TEXTS.en.telegramTokenRemoveButton));
    expect(html, "worker secret note").not.toContain(escapeHtml(TEXTS.en.telegramTokenWorkerSecret));
    expect(html, "saved token").not.toContain(SAVED_TOKEN);
    expect(radioValues(html), "chat ids of the radio inputs").toEqual(FIXTURE_RADIO_VALUES);
    expect(telegram.methods(), "Bot API methods called").toEqual(["getUpdates"]);
    expect(telegram.requests[0]?.token, "token in the URL").toBe(SAVED_TOKEN);
  });

  it("handleSetup uses TELEGRAM_BOT_TOKEN over a saved token for the chat search", async () => {
    await saveBotToken(SAVED_TOKEN);
    const telegram = telegramDouble();

    const response = await stepPage(telegramDeps(telegram));

    expect(response.status, "status").toBe(200);
    expect(
      telegram.requests.map((request) => request.token),
      "tokens in the URLs",
    ).toEqual([BOT_TOKEN]);
  });

  it("handleSetup shows the Worker secret note and no token form when TELEGRAM_BOT_TOKEN is set", async () => {
    await saveBotToken(SAVED_TOKEN);
    const telegram = telegramDouble();

    const response = await stepPage(telegramDeps(telegram));

    const html = await response.text();
    expect(html, "note").toContain(`<p class="notice info">${escapeHtml(TEXTS.en.telegramTokenWorkerSecret)}</p>`);
    expect(html, "token form").not.toContain('action="/setup/telegram/token"');
    expect(html, "remove form").not.toContain('action="/setup/telegram/token/remove"');
    expect(html, "Change token").not.toContain(escapeHtml(TEXTS.en.telegramTokenChange));
    expect(html, "chats are searched").toContain(escapeHtml(TEXTS.en.telegramChatsIntro));
    expect(await savedBotToken(), "saved token stays").toBe(SAVED_TOKEN);
  });

  it("handleSetup shows the saved-token-rejected notice with the open token form and Remove when getUpdates answers 401", async () => {
    await saveBotToken(SAVED_TOKEN);
    const telegram = telegramDouble({ getUpdates: jsonAnswer(401, FIXTURES.unauthorized) });

    const response = await stepPage(savedTokenDeps(telegram));

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "notice").toContain(noticeText("telegram-saved-token-rejected"));
    expect(html, "Worker secret notice").not.toContain(noticeText("telegram-token-rejected"));
    expect(html, "open disclosure").toMatch(/<details\b[^>]*\bopen\b/);
    expect(html, "token form").toContain('action="/setup/telegram/token"');
    expect(html, "remove form").toContain('action="/setup/telegram/token/remove"');
    expect(radioValues(html), "radio inputs").toEqual([]);
    expect(html, "saved token").not.toContain(SAVED_TOKEN);
    expect(html, "Telegram description").not.toContain("Unauthorized");
  });

  it("handleSetup shows the unreadable notice without form or Telegram request for a token saved under another SELUNA_SECRET", async () => {
    await saveBotToken(SAVED_TOKEN, OTHER_SECRET);
    const telegram = telegramDouble();

    const response = await stepPage(savedTokenDeps(telegram));

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "notice").toContain(noticeText("telegram-token-unreadable"));
    expect(html, "forms").not.toContain("<form");
    expect(radioValues(html), "radio inputs").toEqual([]);
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("handleSetup shows the damaged notice with the token form and Remove and no chat search", async () => {
    await saveBotToken(SAVED_TOKEN);
    await damageBotTokenRow();
    const telegram = telegramDouble();

    const response = await stepPage(savedTokenDeps(telegram));

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "notice").toContain(noticeText("telegram-token-damaged"));
    expect(html, "token form").toContain('action="/setup/telegram/token"');
    expect(html, "remove form").toContain('action="/setup/telegram/token/remove"');
    expect(radioValues(html), "radio inputs").toEqual([]);
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("handleSetup shows the damaged notice for a saved value outside the bot token form", async () => {
    await saveBotToken("1:a/../setWebhook");
    const telegram = telegramDouble();

    const response = await stepPage(savedTokenDeps(telegram));

    const html = await response.text();
    expect(html, "notice").toContain(noticeText("telegram-token-damaged"));
    expect(html, "saved value").not.toContain("setWebhook");
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("handleSetup keeps a saved token stored and unused while TELEGRAM_BOT_TOKEN is malformed", async () => {
    await saveBotToken(SAVED_TOKEN);
    const telegram = telegramDouble();

    const response = await stepPage(
      telegramDeps(telegram, { env: { SELUNA_SECRET: SECRET, TELEGRAM_BOT_TOKEN: "1:a/../setWebhook" } }),
    );

    const html = await response.text();
    expect(html, "malformed notice").toContain(noticeText("telegram-token-malformed"));
    expect(html, "token form").not.toContain('action="/setup/telegram/token"');
    expect(telegram.requests, "Telegram requests").toEqual([]);
    expect(await savedBotToken(), "saved token stays").toBe(SAVED_TOKEN);
  });
});

describe("handleSetup Telegram token form", () => {
  it("handleSetup saves a token Telegram accepts and redirects to the Telegram step", async () => {
    const telegram = telegramDouble();

    const response = await saveToken([NEW_TOKEN], savedTokenDeps(telegram));

    expect(response.status, "status").toBe(303);
    expect(response.headers.get("Location"), "Location").toBe(STEP_PATH);
    expect(telegram.methods(), "Bot API methods called").toEqual(["getMe"]);
    expect(telegram.requests[0]?.token, "token in the URL").toBe(NEW_TOKEN);
    expect(await savedBotToken(), "saved token").toBe(NEW_TOKEN);
    expect(await databaseText(), "database rows").not.toContain(NEW_TOKEN);
  });

  it("handleSetup shows the saved state after a token was saved", async () => {
    const telegram = telegramDouble();
    const deps = savedTokenDeps(telegram);
    await saveToken([NEW_TOKEN], deps);

    const response = await stepPage(deps);

    const html = await response.text();
    expect(html, "saved text").toContain(escapeHtml(TEXTS.en.telegramTokenSaved));
    expect(telegram.methods(), "Bot API methods called").toEqual(["getMe", "getUpdates"]);
    expect(telegram.requests[1]?.token, "token of the chat search").toBe(NEW_TOKEN);
  });

  it("handleSetup saves a token of a bot with a webhook and then shows the conflict notice", async () => {
    const telegram = telegramDouble({ getUpdates: jsonAnswer(409, FIXTURES.conflict) });
    const deps = savedTokenDeps(telegram);

    const saved = await saveToken([NEW_TOKEN], deps);
    const page = await stepPage(deps);

    expect(saved.status, "status of the save").toBe(303);
    expect(await savedBotToken(), "saved token").toBe(NEW_TOKEN);
    const html = await page.text();
    expect(html, "conflict notice").toContain(noticeText("telegram-conflict"));
    expect(html, "saved text").toContain(escapeHtml(TEXTS.en.telegramTokenSaved));
  });

  it("handleSetup replaces the saved token with an accepted one and keeps the saved chat", async () => {
    await saveBotToken(SAVED_TOKEN);
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', '5001001')").run();
    const telegram = telegramDouble();

    const response = await saveToken([NEW_TOKEN], savedTokenDeps(telegram));

    expect(response.status, "status").toBe(303);
    expect(await savedBotToken(), "saved token").toBe(NEW_TOKEN);
    expect(await savedChat(), "saved chat").toBe("5001001");
    expect(
      telegram.requests.map((request) => request.token),
      "tokens in the URLs",
    ).toEqual([NEW_TOKEN]);
  });

  it.each<{ case: string; fields: readonly string[]; answer: TelegramAnswer; status: number }>([
    { case: "malformed", fields: ["1:a/../setWebhook"], answer: jsonAnswer(200, FIXTURES.getMe), status: 400 },
    { case: "rejected with 401", fields: [NEW_TOKEN], answer: jsonAnswer(401, FIXTURES.unauthorized), status: 502 },
    { case: "unavailable", fields: [NEW_TOKEN], answer: jsonAnswer(500, { ok: false }), status: 502 },
  ])(
    "handleSetup keeps the saved token and the saved chat when the new token is $case",
    async ({ fields, answer, status }) => {
      await saveBotToken(SAVED_TOKEN);
      await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', '5001001')").run();
      const telegram = telegramDouble({ getMe: answer });
      const before = await databaseText();

      const response = await saveToken(fields, savedTokenDeps(telegram));

      expect(response.status, "status").toBe(status);
      expect(await savedBotToken(), "saved token").toBe(SAVED_TOKEN);
      expect(await savedChat(), "saved chat").toBe("5001001");
      expect(await databaseText(), "database rows").toBe(before);
    },
  );

  it.each<{ case: string; rest: string; needle: string }>([
    { case: "empty", rest: "&token=", needle: "no-needle-for-the-empty-token" },
    { case: "with a leading space", rest: `&token=%20${encodeURIComponent(NEW_TOKEN)}`, needle: "CCH-new_throwaway" },
    {
      case: "with a trailing line feed",
      rest: `&token=${encodeURIComponent(NEW_TOKEN)}%0A`,
      needle: "CCH-new_throwaway",
    },
    { case: "with a plus that decodes to a space", rest: "&token=555555555%3Aabc+defgh", needle: "defgh" },
    { case: "with a percent-encoded slash", rest: "&token=555555555%3Aabc%2F..%2FsetWebhook", needle: "setWebhook" },
    { case: "with a question mark", rest: "&token=555555555%3Aabc%3Fx%3Dquerymark", needle: "querymark" },
    { case: "with a number sign", rest: "&token=555555555%3Aabc%23fragmentmark", needle: "fragmentmark" },
    { case: "with a percent sign", rest: "&token=555555555%3Aabc%25percentmark", needle: "percentmark" },
    { case: "with a dot", rest: "&token=555555555%3Aabc.dotmark", needle: "dotmark" },
    { case: "with a backslash", rest: "&token=555555555%3Aabc%5Cbackslashmark", needle: "backslashmark" },
    { case: "with an Arabic-Indic digit", rest: "&token=%D9%A3%3Aarabicmark", needle: "arabicmark" },
    { case: "with 21 digits before the colon", rest: `&token=${"7".repeat(21)}%3Aabc`, needle: "7".repeat(21) },
    { case: "with 201 characters after the colon", rest: `&token=7%3A${"b".repeat(201)}`, needle: "b".repeat(201) },
    { case: "missing", rest: "", needle: "no-needle-for-a-missing-token" },
    {
      case: "repeated",
      rest: `&token=${encodeURIComponent(NEW_TOKEN)}&token=${encodeURIComponent(NEW_TOKEN)}`,
      needle: "CCH-new_throwaway",
    },
  ])(
    "handleSetup answers 400, saves nothing and calls no Telegram API for the token $case",
    async ({ rest, needle }) => {
      const telegram = telegramDouble();

      const response = await rawTokenForm(rest, savedTokenDeps(telegram));

      expect(response.status, "status").toBe(400);
      const html = await response.text();
      expect(html, "not a bot token notice").toContain(noticeText("telegram-token-invalid"));
      expect(html, "token form again").toContain('action="/setup/telegram/token"');
      expect(html, "submitted value").not.toContain(needle);
      expect(/<input\b(?=[^>]*name="token")[^>]*>/.exec(html)?.[0] ?? "", "token input").not.toMatch(/\svalue=/);
      expect(telegram.requests, "Telegram requests").toEqual([]);
      expect(await secretsCount(), "number of secrets rows").toBe(0);
    },
  );

  it.each([{ status: 401 }, { status: 404 }])(
    "handleSetup answers 502 and saves nothing when getMe answers $status",
    async ({ status }) => {
      const telegram = telegramDouble({ getMe: jsonAnswer(status, FIXTURES.unauthorized) });

      const response = await saveToken([NEW_TOKEN], savedTokenDeps(telegram));

      expect(response.status, "status").toBe(502);
      const html = await response.text();
      expect(html, "not accepted notice").toContain(noticeText("telegram-token-not-accepted"));
      expect(html, "token form again").toContain('action="/setup/telegram/token"');
      expect(html, "submitted token").not.toContain(NEW_TOKEN);
      expect(html, "Telegram description").not.toContain("Unauthorized");
      expect(await secretsCount(), "number of secrets rows").toBe(0);
      expect(telegram.methods(), "Bot API methods called").toEqual(["getMe"]);
    },
  );

  it.each<{ case: string; answer: TelegramAnswer }>([
    { case: "rejects", answer: REJECTED },
    {
      case: "answers 429",
      answer: jsonAnswer(429, { ok: false, error_code: 429, parameters: { retry_after: 3 } }),
    },
    {
      case: "answers 500",
      answer: jsonAnswer(500, { ok: false, error_code: 500, description: "Internal Server Error" }),
    },
    {
      case: "answers with a body above 1 MiB",
      answer: { kind: "raw", status: 200, body: `{"ok":true}${" ".repeat(MAX_TELEGRAM_RESPONSE_BYTES)}` },
    },
    { case: "answers with a body that is not JSON", answer: { kind: "raw", status: 200, body: "<html>" } },
    { case: "answers 200 with ok false", answer: jsonAnswer(200, { ok: false }) },
  ])("handleSetup answers 502 and saves nothing when getMe $case", async ({ answer }) => {
    const telegram = telegramDouble({ getMe: answer });

    const response = await saveToken([NEW_TOKEN], savedTokenDeps(telegram));

    expect(response.status, "status").toBe(502);
    const html = await response.text();
    expect(html, "unverified notice").toContain(noticeText("telegram-token-unverified"));
    expect(html, "token form again").toContain('action="/setup/telegram/token"');
    expect(html, "runtime error text").not.toContain("Network connection lost");
    expect(html, "Telegram description").not.toContain("Internal Server Error");
    expect(await secretsCount(), "number of secrets rows").toBe(0);
  });

  it("handleSetup answers a token form in German in the language of the page", async () => {
    const telegram = telegramDouble();

    const response = await postSignedIn(
      `${TOKEN_PATH}?lang=de`,
      await tokenFields(["1:a/../x"]),
      savedTokenDeps(telegram),
    );

    expect(response.status, "status").toBe(400);
    expect(await response.text(), "German notice").toContain(noticeText("telegram-token-invalid", "de"));
  });

  it("handleSetup answers 409 with the token-not-saved notice when the GitHub credentials cannot be read and no token is saved", async () => {
    await saveGitHubCredentials(OTHER_SECRET);
    const telegram = telegramDouble();
    const before = await databaseText();

    const response = await saveToken([NEW_TOKEN], savedTokenDeps(telegram));

    expect(response.status, "status").toBe(409);
    const html = await response.text();
    expect(html, "not saved notice").toContain(noticeText("telegram-token-not-saved"));
    expect(html, "chat search").not.toContain(escapeHtml(TEXTS.en.telegramChatsIntro));
    expect(telegram.requests, "Telegram requests").toEqual([]);
    expect(await databaseText(), "database rows").toBe(before);
  });

  it("handleSetup replaces a damaged token row and keeps the GitHub credentials", async () => {
    await saveGitHubCredentials();
    await saveBotToken(SAVED_TOKEN);
    await damageBotTokenRow();
    const telegram = telegramDouble();

    const response = await saveToken([NEW_TOKEN], savedTokenDeps(telegram));

    expect(response.status, "status").toBe(303);
    expect(await savedBotToken(), "saved token").toBe(NEW_TOKEN);
    expect(await gitHubAppId(), "App ID").toEqual({ kind: "ok", value: "12345" });
  });

  it.each(TOKEN_FORMS)(
    "handleSetup answers 409 to $form while TELEGRAM_BOT_TOKEN is set and keeps the saved token",
    async ({ path }) => {
      await saveBotToken(SAVED_TOKEN);
      const telegram = telegramDouble();
      const before = await databaseText();

      const response = await postToForm(path, telegramDeps(telegram));

      expect(response.status, "status").toBe(409);
      const html = await response.text();
      expect(html, "Worker secret note").toContain(escapeHtml(TEXTS.en.telegramTokenWorkerSecret));
      expect(html, "forms").not.toContain("<form");
      expect(html, "chat part").not.toContain(`<h2>${escapeHtml(TEXTS.en.telegramChatHeading)}</h2>`);
      expect(telegram.requests, "Telegram requests").toEqual([]);
      expect(await databaseText(), "database rows").toBe(before);
      expect(await savedBotToken(), "saved token").toBe(SAVED_TOKEN);
    },
  );

  it.each(TOKEN_FORMS)("handleSetup answers 409 to $form when the saved token cannot be read", async ({ path }) => {
    await saveBotToken(SAVED_TOKEN, OTHER_SECRET);
    const telegram = telegramDouble();
    const before = await databaseText();

    const response = await postToForm(path, savedTokenDeps(telegram));

    expect(response.status, "status").toBe(409);
    const html = await response.text();
    expect(html, "unreadable notice").toContain(noticeText("telegram-token-unreadable"));
    expect(html, "forms").not.toContain("<form");
    expect(telegram.requests, "Telegram requests").toEqual([]);
    expect(await databaseText(), "database rows").toBe(before);
  });

  it.each(TOKEN_FORMS)(
    "handleSetup answers 503 unavailable without a Telegram request when D1 fails on $form",
    async ({ path }) => {
      const telegram = telegramDouble();

      const response = await postToForm(path, savedTokenDeps(telegram, { db: migrationTestDb() }));

      expect(response.status, "status").toBe(503);
      const html = await response.text();
      expectNoticeOnlyPage(html, "unavailable");
      expectNoErrorText(html);
      expect(telegram.requests, "Telegram requests").toEqual([]);
    },
  );

  it.each(TOKEN_FORMS.flatMap((form) => CSRF_FAILURES.map((failure) => ({ ...form, failure }))))(
    "handleSetup answers 403 form expired to $form with a bad CSRF token and changes nothing: $failure.name",
    async ({ path, failure }) => {
      await saveBotToken(SAVED_TOKEN);
      const before = await databaseText();
      const telegram = telegramDouble();
      const csrf = (await failure.tokens()).map((token): [string, string] => ["csrf", token]);

      const response = await postSignedIn(path, [...csrf, ["token", NEW_TOKEN]], savedTokenDeps(telegram));

      expect(response.status, "status").toBe(403);
      expectNoticeOnlyPage(await response.text(), "form-expired");
      expect(telegram.requests, "Telegram requests").toEqual([]);
      expect(await databaseText(), "database rows").toBe(before);
    },
  );

  it.each(TOKEN_FORMS)("handleSetup answers 413 to an oversized $form and changes nothing", async ({ path }) => {
    await saveBotToken(SAVED_TOKEN);
    const before = await databaseText();
    const telegram = telegramDouble();

    const response = await call(
      path,
      {
        method: "POST",
        cookies: await signedInCookies(),
        body: `token=${NEW_TOKEN}&${"a".repeat(MAX_BODY_BYTES + 1)}`,
      },
      savedTokenDeps(telegram),
    );

    expect(response.status, "status").toBe(413);
    expect(await response.text(), "body").toBe("");
    expect(telegram.requests, "Telegram requests").toEqual([]);
    expect(await databaseText(), "database rows").toBe(before);
  });

  it.each(TOKEN_FORMS)("handleSetup answers 400 to an unreadable $form body and changes nothing", async ({ path }) => {
    await saveBotToken(SAVED_TOKEN);
    const before = await databaseText();
    const telegram = telegramDouble();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("connection lost"));
      },
    });

    const response = await call(
      path,
      { method: "POST", cookies: await signedInCookies(), body },
      savedTokenDeps(telegram),
    );

    expect(response.status, "status").toBe(400);
    expect(await response.text(), "body").toBe("");
    expect(telegram.requests, "Telegram requests").toEqual([]);
    expect(await databaseText(), "database rows").toBe(before);
  });
});

describe("handleSetup Telegram remove form", () => {
  it("handleSetup removes the saved token, keeps the saved chat and shows the token form again", async () => {
    await saveBotToken(SAVED_TOKEN);
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', '5001001')").run();
    const telegram = telegramDouble();
    const deps = savedTokenDeps(telegram);

    const response = await removeToken(deps);
    const page = await stepPage(deps);

    expect(response.status, "status").toBe(303);
    expect(response.headers.get("Location"), "Location").toBe(STEP_PATH);
    expect(await savedBotToken(), "saved token").toBeUndefined();
    expect(await secretsCount(), "number of secrets rows").toBe(0);
    expect(await storedKeyCheckRow(), "key check value after the last credential").toBeUndefined();
    expect(await savedChat(), "saved chat").toBe("5001001");
    const html = await page.text();
    expect(html, "token form").toContain('action="/setup/telegram/token"');
    expect(html, "token intro").toContain(escapeHtml(TEXTS.en.telegramTokenIntro));
    expect(html, "saved chat line").toContain("5001001");
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("handleSetup answers a removal without a saved token like a removal", async () => {
    const telegram = telegramDouble();

    const response = await removeToken(savedTokenDeps(telegram));

    expect(response.status, "status").toBe(303);
    expect(response.headers.get("Location"), "Location").toBe(STEP_PATH);
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("handleSetup keeps the GitHub credentials when the saved token is removed", async () => {
    await saveGitHubCredentials();
    await saveBotToken(SAVED_TOKEN);
    const telegram = telegramDouble();

    const response = await removeToken(savedTokenDeps(telegram));

    expect(response.status, "status").toBe(303);
    expect(await savedBotToken(), "saved token").toBeUndefined();
    expect(await gitHubAppId(), "App ID").toEqual({ kind: "ok", value: "12345" });
    expect(await storedKeyCheckRow(), "key check value while credentials remain").toBeDefined();
  });

  it("handleSetup deletes a damaged token row and keeps the GitHub credentials", async () => {
    await saveGitHubCredentials();
    await saveBotToken(SAVED_TOKEN);
    await damageBotTokenRow();
    const telegram = telegramDouble();

    const response = await removeToken(savedTokenDeps(telegram));

    expect(response.status, "status").toBe(303);
    expect(await gitHubAppId(), "App ID").toEqual({ kind: "ok", value: "12345" });
    const rows = await env.DB.prepare("SELECT key FROM secrets ORDER BY key").all();
    expect(
      rows.results.map((row) => row.key),
      "remaining secrets keys",
    ).toEqual(["github_app_id", "github_private_key", "github_webhook_secret"]);
  });
});

describe("handleSetup Telegram confirm form with the saved token", () => {
  it("handleSetup sends the test message with the saved token", async () => {
    await saveBotToken(SAVED_TOKEN);
    const telegram = telegramDouble();

    const response = await confirm([String(PRIVATE_CHAT)], savedTokenDeps(telegram));

    expect(response.status, "status").toBe(200);
    expect(telegram.methods(), "Bot API methods called").toEqual(["sendMessage"]);
    expect(telegram.requests[0]?.token, "token in the URL").toBe(SAVED_TOKEN);
  });

  it.each([{ status: 401 }, { status: 404 }])(
    "handleSetup answers 502 with the saved-token-rejected notice when sendMessage answers $status for the saved token",
    async ({ status }) => {
      await saveBotToken(SAVED_TOKEN);
      const telegram = telegramDouble({ sendMessage: jsonAnswer(status, FIXTURES.unauthorized) });

      const response = await confirm([String(PRIVATE_CHAT)], savedTokenDeps(telegram));

      expect(response.status, "status").toBe(502);
      const html = await response.text();
      expect(html, "saved token notice").toContain(noticeText("telegram-saved-token-rejected"));
      expect(html, "Worker secret notice").not.toContain(noticeText("telegram-token-rejected"));
      expect(html, "open disclosure").toMatch(/<details\b[^>]*\bopen\b/);
      expect(html, "token form").toContain('action="/setup/telegram/token"');
      expect(html, "remove form").toContain('action="/setup/telegram/token/remove"');
      expect(html, "saved token").not.toContain(SAVED_TOKEN);
      expect(await settingsRowCount(), "number of settings rows").toBe(0);
    },
  );

  it.each<{ case: string; arrange: () => Promise<void> }>([
    { case: "unreadable", arrange: () => saveBotToken(SAVED_TOKEN, OTHER_SECRET) },
    {
      case: "damaged",
      arrange: async () => {
        await saveBotToken(SAVED_TOKEN);
        await damageBotTokenRow();
      },
    },
    { case: "outside the bot token form", arrange: () => saveBotToken("1:a/../setWebhook") },
  ])("handleSetup answers 503 with the token-missing notice when the saved token is $case", async ({ arrange }) => {
    await arrange();
    const telegram = telegramDouble();

    const response = await confirm([String(PRIVATE_CHAT)], savedTokenDeps(telegram));

    expect(response.status, "status").toBe(503);
    expectNoticeOnlyPage(await response.text(), "telegram-token-missing");
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("handleSetup answers the confirm form with 503 unavailable and no Telegram request when D1 fails", async () => {
    const telegram = telegramDouble();

    const response = await confirm([String(PRIVATE_CHAT)], savedTokenDeps(telegram, { db: migrationTestDb() }));

    expect(response.status, "status").toBe(503);
    const html = await response.text();
    expectNoticeOnlyPage(html, "unavailable");
    expectNoErrorText(html);
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });
});

describe("handleSetup Telegram step with TELEGRAM_CHAT_ID set", () => {
  it("handleSetup shows the token form and the chat id note when TELEGRAM_CHAT_ID is set and no token is available", async () => {
    const telegram = telegramDouble();

    const response = await stepPage(savedTokenDeps(telegram, { env: TOKEN_CHAT_ENV }));

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "token form").toContain('action="/setup/telegram/token"');
    expect(html, "token intro").toContain(escapeHtml(TEXTS.en.telegramTokenIntro));
    expect(html, "chat id note").toContain(escapeHtml(TEXTS.en.telegramChatIdSecret));
    expect(html, "chats intro").not.toContain(escapeHtml(TEXTS.en.telegramChatsIntro));
    expect(html, "value of the secret").not.toContain(CHAT_SECRET_VALUE);
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("handleSetup saves a token while TELEGRAM_CHAT_ID is set with exactly one getMe and no getUpdates", async () => {
    const telegram = telegramDouble();
    const deps = savedTokenDeps(telegram, { env: TOKEN_CHAT_ENV });

    const response = await saveToken([NEW_TOKEN], deps);

    expect(response.status, "status").toBe(303);
    expect(telegram.methods(), "Bot API methods called").toEqual(["getMe"]);
    expect(await savedBotToken(), "saved token").toBe(NEW_TOKEN);
  });

  it("handleSetup removes the saved token while TELEGRAM_CHAT_ID is set", async () => {
    await saveBotToken(SAVED_TOKEN);
    const telegram = telegramDouble();

    const response = await removeToken(savedTokenDeps(telegram, { env: TOKEN_CHAT_ENV }));

    expect(response.status, "status").toBe(303);
    expect(await savedBotToken(), "saved token").toBeUndefined();
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("handleSetup shows a saved token with the chat id note and calls no Telegram API when TELEGRAM_CHAT_ID is set", async () => {
    await saveBotToken(SAVED_TOKEN);
    const telegram = telegramDouble();

    const response = await stepPage(savedTokenDeps(telegram, { env: TOKEN_CHAT_ENV }));

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "saved text").toContain(escapeHtml(TEXTS.en.telegramTokenSaved));
    expect(html, "Change token").toContain(escapeHtml(TEXTS.en.telegramTokenChange));
    expect(html, "remove form").toContain('action="/setup/telegram/token/remove"');
    expect(html, "chat id note").toContain(escapeHtml(TEXTS.en.telegramChatIdSecret));
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it.each<{ case: string; env: object; arrange: () => Promise<void>; expected: string }>([
    {
      case: "the Worker secret",
      env: { ...TOKEN_CHAT_ENV, TELEGRAM_BOT_TOKEN: BOT_TOKEN },
      arrange: () => Promise.resolve(),
      expected: escapeHtml(TEXTS.en.telegramTokenWorkerSecret),
    },
    {
      case: "a malformed Worker secret",
      env: { ...TOKEN_CHAT_ENV, TELEGRAM_BOT_TOKEN: "1:a/../setWebhook" },
      arrange: () => Promise.resolve(),
      expected: noticeText("telegram-token-malformed"),
    },
    {
      case: "an unreadable saved token",
      env: TOKEN_CHAT_ENV,
      arrange: () => saveBotToken(SAVED_TOKEN, OTHER_SECRET),
      expected: noticeText("telegram-token-unreadable"),
    },
    {
      case: "a damaged saved token",
      env: TOKEN_CHAT_ENV,
      arrange: async () => {
        await saveBotToken(SAVED_TOKEN);
        await damageBotTokenRow();
      },
      expected: noticeText("telegram-token-damaged"),
    },
  ])(
    "handleSetup shows the token part for $case beside the chat id note and calls no Telegram API",
    async ({ env: environment, arrange, expected }) => {
      await arrange();
      const telegram = telegramDouble();

      const response = await stepPage(savedTokenDeps(telegram, { env: environment }));

      expect(response.status, "status").toBe(200);
      const html = await response.text();
      expect(html, "token part").toContain(expected);
      expect(html, "chat id note").toContain(escapeHtml(TEXTS.en.telegramChatIdSecret));
      expect(telegram.requests, "Telegram requests").toEqual([]);
    },
  );

  it("handleSetup answers 409 with the token-not-saved notice for a token form while TELEGRAM_CHAT_ID is set and the credentials cannot be read", async () => {
    await saveGitHubCredentials(OTHER_SECRET);
    const telegram = telegramDouble();

    const response = await saveToken([NEW_TOKEN], savedTokenDeps(telegram, { env: TOKEN_CHAT_ENV }));

    expect(response.status, "status").toBe(409);
    expect(await response.text(), "not saved notice").toContain(noticeText("telegram-token-not-saved"));
    expect(telegram.requests, "Telegram requests").toEqual([]);
    expect(await savedBotToken(), "saved token").toBeUndefined();
  });
});

describe("handleSetup status page with the bot token", () => {
  it.each<{
    case: string;
    environment: object;
    arrange: () => Promise<void>;
    key: "botTokenSecret" | "botTokenSaved" | "noneSavedYet" | "cannotBeRead";
  }>([
    {
      case: "the Worker secret",
      environment: WORKER_TOKEN_ENV,
      arrange: () => Promise.resolve(),
      key: "botTokenSecret",
    },
    {
      case: "a saved token",
      environment: TOKEN_ONLY_ENV,
      arrange: () => saveBotToken(SAVED_TOKEN),
      key: "botTokenSaved",
    },
    { case: "no token", environment: TOKEN_ONLY_ENV, arrange: () => Promise.resolve(), key: "noneSavedYet" },
    {
      case: "an unreadable token",
      environment: TOKEN_ONLY_ENV,
      arrange: () => saveBotToken(SAVED_TOKEN, OTHER_SECRET),
      key: "cannotBeRead",
    },
  ])(
    "GET /setup shows the Telegram bot token line for $case without a Telegram request",
    async ({ environment, arrange, key }) => {
      await arrange();
      const telegram = telegramDouble();

      const response = await stepPage(savedTokenDeps(telegram, { env: environment }), "/setup");

      expect(response.status, "status").toBe(200);
      const html = await response.text();
      expect(html, "bot token line").toContain(
        `<p>${escapeHtml(TEXTS.en.botTokenLabel)} ${escapeHtml(TEXTS.en[key])}</p>`,
      );
      expect(telegram.requests, "Telegram requests").toEqual([]);
    },
  );
});
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

  it("GET /setup/github/callback signed out shows the step navigation with GitHub App as the current item for a valid return", async () => {
    const state = await githubState(PERSONAL_GITHUB);

    const response = await call(
      callbackPath([
        ["code", FIXTURE_CODE],
        ["state", state],
      ]),
    );

    expect(response.status, "status").toBe(200);
    expectGitHubStepNavigation(await response.text());
  });

  it("GET /setup/github/callback signed out shows the step navigation with GitHub App as the current item for an invalid return", async () => {
    const response = await call(
      callbackPath([["state", `v1.personal.octocat.1700003600000.${"A".repeat(22)}.${"B".repeat(43)}`]]),
    );

    expect(response.status, "status").toBe(400);
    expectGitHubStepNavigation(await response.text());
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
  ["rule_issue_opened", "on"],
  ["rule_issue_comment", "on"],
  ["rule_pull_request_comment", "on"],
  ["update_notice", "on"],
];

/** The settings `VALID_SETTINGS_FIELDS` submit: every rule on but the Dependabot alert. */
const SUBMITTED_SETTINGS: NotificationSettings = {
  language: "de",
  timeZone: "Europe/Berlin",
  quietHours: { start: "22:00", end: "07:00" },
  rules: { ...DEFAULT_SETTINGS.rules, dependabot_alert: false },
  updateNotice: true,
  activityDigest: { kind: "immediate" },
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

/** The installations line of the English start page when the installations cannot be loaded. */
const UNAVAILABLE_LINE = `<p>${TEXTS.en.installationsLabel} ${escapeHtml(TEXTS.en.installationsUnavailable)}</p>`;

describe("handleSetup status page", () => {
  it("GET /setup shows version, chat, app and last delivery", async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', '5001001')").run();
    await seedAppId(SECRET, "12345");
    await putMeta("github_app_slug", "12345:seluna-demo");
    await putMeta("last_delivery", "1792240440000");
    const github = githubApiDouble({});

    const response = await stepPage(githubDeps(github), "/setup");

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expectStartPage(html);
    expect(html, "installations line of a saved app without a key").toContain(UNAVAILABLE_LINE);
    expect(github.requests, "GitHub requests").toEqual([]);
    expect(html, "status heading").toContain(escapeHtml(TEXTS.en.statusHeading));
    expect(html, "version").toContain("0.0.0-test");
    expect(html, "chat line").toMatch(new RegExp(`${escapeRegExp(TEXTS.en.telegramChatLabel)}[\\s\\S]{0,40}5001001`));
    expect(html, "app link").toContain('<a href="https://github.com/apps/seluna-demo">seluna-demo</a>');
    expect(html, "App ID").toContain(`(${escapeHtml(TEXTS.en.appIdLabel)} 12345)`);
    expect(html, "last delivery").toContain("2026-10-17 12:34 (UTC)");
    expect(html, "reset form").not.toContain('action="/setup/reset"');
    expect(html, "settings form").toContain('action="/setup/settings"');
  });

  it("GET /setup lists the installations of a saved app below the GitHub App line", async () => {
    const stored = await writeSecrets(env.DB, await keyFor(SECRET), {
      github_app_id: "12345",
      github_private_key: FIXTURE_PKCS8,
      github_webhook_secret: "webhook-secret-text",
    });
    expect(stored, "saving the app").toEqual({ kind: "ok" });
    const github = githubApiDouble({
      app: githubJsonAnswer(500, { message: "Server Error" }),
      installations: githubJsonAnswer(200, [
        installationEntry({ account: { login: "octocat", type: "User" }, repository_selection: "all" }),
      ]),
    });

    const response = await stepPage(githubDeps(github), "/setup");

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "installations block").toContain(
      `<p>${TEXTS.en.installationsLabel}</p>\n<ul>\n<li>octocat (${TEXTS.en.accountPersonal}), ${TEXTS.en.repositoriesAll}</li>\n</ul>`,
    );
    expect(html.indexOf(TEXTS.en.installationsLabel), "installations come after the GitHub App line").toBeGreaterThan(
      html.indexOf(escapeHtml(TEXTS.en.githubAppLabel)),
    );
    expect(
      github.requests.map((request) => request.route),
      "GitHub requests",
    ).toEqual(expect.arrayContaining(["app", "installations"]));
    expect(github.requests.length, "number of GitHub requests").toBe(2);
  });

  it("GET /setup shows the owner of GET /app and stores it for the saved App ID", async () => {
    const stored = await writeSecrets(env.DB, await keyFor(SECRET), {
      github_app_id: "12345",
      github_private_key: FIXTURE_PKCS8,
      github_webhook_secret: "webhook-secret-text",
    });
    expect(stored, "saving the app").toEqual({ kind: "ok" });
    const github = githubApiDouble({
      app: githubJsonAnswer(
        200,
        appBody({
          id: 12_345,
          slug: "seluna-demo",
          owner: { id: 583_231, login: "octocat", type: "User" },
          permissions: FULL_PERMISSIONS,
          events: FULL_EVENTS,
        }),
      ),
      installations: githubJsonAnswer(200, []),
    });

    const response = await stepPage(githubDeps(github), "/setup");

    expect(response.status, "status").toBe(200);
    expect(await response.text(), "owner line").toContain("octocat (personal account)</p>");
    const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'github_app_owner'").first();
    expect(row?.value, "stored owner row").toBe("12345:583231:User:octocat");
  });

  it("GET /setup lists the installations of an app from the Worker secrets in GitHub's order", async () => {
    const github = githubApiDouble({
      app: githubJsonAnswer(500, { message: "Server Error" }),
      installations: githubJsonAnswer(200, [
        installationEntry({ id: 1, account: { login: "octocat", type: "User" }, repository_selection: "all" }),
        installationEntry({ id: 2, account: { login: "octo-org", type: "Organization" } }),
      ]),
    });
    const deps = githubSecretDeps(github, { ...GITHUB_WORKER_SECRETS, GITHUB_APP_PRIVATE_KEY: FIXTURE_PEM });

    const response = await stepPage(deps, "/setup");

    expect(response.status, "status").toBe(200);
    expect(await response.text(), "installations block").toContain(
      `<li>octocat (${TEXTS.en.accountPersonal}), ${TEXTS.en.repositoriesAll}</li>\n` +
        `<li>octo-org (${TEXTS.en.accountOrganization}), ${TEXTS.en.repositoriesSelected}</li>`,
    );
    expect(github.requests.length, "number of GitHub requests").toBe(2);
  });

  it.each([
    { case: "the request fails", answer: GITHUB_REJECTED },
    { case: "GitHub answers 500", answer: githubJsonAnswer(500, { message: "Server Error" }) },
    { case: "GitHub refuses the app token", answer: githubJsonAnswer(401, { message: "Bad credentials" }) },
    { case: "the answer is not JSON", answer: { kind: "raw", status: 200, body: "not json" } },
  ] satisfies readonly { readonly case: string; readonly answer: GitHubAnswer }[])(
    "GET /setup answers 200 with installations unavailable when GitHub fails: $case",
    async ({ answer }) => {
      const github = githubApiDouble({
        app: githubJsonAnswer(500, { message: "Server Error" }),
        installations: answer,
      });
      const deps = githubSecretDeps(github, { ...GITHUB_WORKER_SECRETS, GITHUB_APP_PRIVATE_KEY: FIXTURE_PEM });

      const response = await stepPage(deps, "/setup");

      expect(response.status, "status").toBe(200);
      const html = await response.text();
      expect(html, "installations line").toContain(UNAVAILABLE_LINE);
      expect(html, "settings form").toContain('action="/setup/settings"');
    },
  );

  it("GET /setup shows key unusable and sends no request for a Worker secret key that does not import", async () => {
    const github = githubApiDouble({});

    const response = await stepPage(githubSecretDeps(github, GITHUB_WORKER_SECRETS), "/setup");

    expect(response.status, "status").toBe(200);
    expect(await response.text(), "installations line").toContain(
      `<p>${TEXTS.en.installationsLabel} ${escapeHtml(TEXTS.en.keyUnusable)}</p>`,
    );
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it("GET /setup signed out answers the login page and calls neither GitHub nor D1 although an app is configured", async () => {
    const github = githubApiDouble({});
    const deps = githubSecretDeps(github, { ...GITHUB_WORKER_SECRETS, GITHUB_APP_PRIVATE_KEY: FIXTURE_PEM });

    const response = await call("/setup", {}, { ...deps, db: unusedDb() });

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expectLoginPage(html);
    expect(html, "installations label").not.toContain(TEXTS.en.installationsLabel);
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it("GET /setup shows no installations line and sends no request for partial Worker secrets", async () => {
    const github = githubApiDouble({});

    const response = await stepPage(githubSecretDeps(github, { GITHUB_APP_ID: "12345" }), "/setup");

    expect(response.status, "status").toBe(200);
    expect(await response.text(), "installations label").not.toContain(TEXTS.en.installationsLabel);
    expect(github.requests, "GitHub requests").toEqual([]);
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
    expect(html, "installations line without an app").not.toContain(TEXTS.en.installationsLabel);
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
    expect(html, "installations line of an unreadable app").not.toContain(TEXTS.en.installationsLabel);
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
    const github = githubApiDouble({});

    const response = await postSignedIn(RESET_PATH, [["csrf", await validCsrf()]], githubDeps(github));

    expect(response.status, "status").toBe(409);
    const html = await response.text();
    expect(html, "notice").toContain(noticeText("reset-not-needed"));
    expect(html, "installations line of a saved app without a key").toContain(UNAVAILABLE_LINE);
    expect(github.requests, "GitHub requests").toEqual([]);
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

  it.each(PATHS)("POST %s without a session answers the login page and changes nothing", async (path) => {
    const response = await call(
      path,
      { method: "POST", body: form(fieldsFor(path, [])) },
      depsAt(NOW.getTime(), { db: unusedDb() }),
    );

    expect(response.status, "status").toBe(200);
    expectLoginPage(await response.text());
  });

  it.each(PATHS)("GET %s answers 404 when signed in", async (path) => {
    const response = await call(path, { cookies: await signedInCookies() });

    expect(response.status, "status").toBe(404);
    expect(await response.text(), "body").toBe("");
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

describe("handleSetup token secrecy", () => {
  const MALFORMED_TOKEN = "555555555:bad/value";

  interface SecrecyCase {
    readonly case: string;
    /** Every token text that must be absent from the answer and the log entries. */
    readonly secrets: readonly string[];
    readonly run: () => Promise<Response>;
  }

  const SECRECY_CASES: readonly SecrecyCase[] = [
    {
      case: "a token is saved (303)",
      secrets: [NEW_TOKEN],
      run: () => saveToken([NEW_TOKEN], savedTokenDeps(telegramDouble())),
    },
    {
      case: "a saved token is replaced (303)",
      secrets: [NEW_TOKEN, SAVED_TOKEN],
      run: async () => {
        await saveBotToken(SAVED_TOKEN);
        return saveToken([NEW_TOKEN], savedTokenDeps(telegramDouble()));
      },
    },
    {
      case: "a malformed token is submitted (400)",
      secrets: [MALFORMED_TOKEN, SAVED_TOKEN],
      run: async () => {
        await saveBotToken(SAVED_TOKEN);
        return saveToken([MALFORMED_TOKEN], savedTokenDeps(telegramDouble()));
      },
    },
    {
      case: "the token is submitted twice (400)",
      secrets: [NEW_TOKEN, SAVED_TOKEN],
      run: async () => {
        await saveBotToken(SAVED_TOKEN);
        return saveToken([NEW_TOKEN, SAVED_TOKEN], savedTokenDeps(telegramDouble()));
      },
    },
    {
      case: "Telegram rejects the token (502)",
      secrets: [NEW_TOKEN, SAVED_TOKEN],
      run: async () => {
        await saveBotToken(SAVED_TOKEN);
        const telegram = telegramDouble({ getMe: jsonAnswer(401, FIXTURES.unauthorized) });
        return saveToken([NEW_TOKEN], savedTokenDeps(telegram));
      },
    },
    {
      case: "Telegram is unavailable on saving (502)",
      secrets: [NEW_TOKEN, SAVED_TOKEN],
      run: async () => {
        await saveBotToken(SAVED_TOKEN);
        return saveToken([NEW_TOKEN], savedTokenDeps(telegramDouble({ getMe: REJECTED })));
      },
    },
    {
      case: "the Worker secret holds the token and a token is submitted (409)",
      secrets: [NEW_TOKEN, BOT_TOKEN, SAVED_TOKEN],
      run: async () => {
        await saveBotToken(SAVED_TOKEN);
        return saveToken([NEW_TOKEN], telegramDeps(telegramDouble()));
      },
    },
    {
      case: "the Worker secret holds the token and a removal is submitted (409)",
      secrets: [BOT_TOKEN, SAVED_TOKEN],
      run: async () => {
        await saveBotToken(SAVED_TOKEN);
        return removeToken(telegramDeps(telegramDouble()));
      },
    },
    {
      case: "the saved token cannot be read and a token is submitted (409)",
      secrets: [NEW_TOKEN, SAVED_TOKEN],
      run: async () => {
        await saveBotToken(SAVED_TOKEN, OTHER_SECRET);
        return saveToken([NEW_TOKEN], savedTokenDeps(telegramDouble()));
      },
    },
    {
      case: "the GitHub credentials cannot be read and a token is submitted (409)",
      secrets: [NEW_TOKEN],
      run: async () => {
        await saveGitHubCredentials(OTHER_SECRET);
        return saveToken([NEW_TOKEN], savedTokenDeps(telegramDouble()));
      },
    },
    {
      case: "the saved token is removed (303)",
      secrets: [SAVED_TOKEN],
      run: async () => {
        await saveBotToken(SAVED_TOKEN);
        return removeToken(savedTokenDeps(telegramDouble()));
      },
    },
    {
      case: "the CSRF token is bad (403)",
      secrets: [NEW_TOKEN, SAVED_TOKEN],
      run: async () => {
        await saveBotToken(SAVED_TOKEN);
        const fields: FormFields = [
          ["csrf", "not-a-valid-token"],
          ["token", NEW_TOKEN],
        ];
        return postSignedIn(TOKEN_PATH, fields, savedTokenDeps(telegramDouble()));
      },
    },
    {
      case: "the body is oversized (413)",
      secrets: [NEW_TOKEN, SAVED_TOKEN],
      run: async () => {
        await saveBotToken(SAVED_TOKEN);
        return call(
          TOKEN_PATH,
          {
            method: "POST",
            cookies: await signedInCookies(),
            body: `token=${NEW_TOKEN}&${"a".repeat(MAX_BODY_BYTES + 1)}`,
          },
          savedTokenDeps(telegramDouble()),
        );
      },
    },
    {
      case: "D1 fails on saving (503)",
      secrets: [NEW_TOKEN],
      run: () => saveToken([NEW_TOKEN], savedTokenDeps(telegramDouble(), { db: migrationTestDb() })),
    },
    {
      case: "D1 fails on removing (503)",
      secrets: [SAVED_TOKEN],
      run: () => removeToken(savedTokenDeps(telegramDouble(), { db: migrationTestDb() })),
    },
    {
      case: "the step page shows a saved token",
      secrets: [SAVED_TOKEN],
      run: async () => {
        await saveBotToken(SAVED_TOKEN);
        return stepPage(savedTokenDeps(telegramDouble()));
      },
    },
    {
      case: "the step page shows a saved token that Telegram rejects",
      secrets: [SAVED_TOKEN],
      run: async () => {
        await saveBotToken(SAVED_TOKEN);
        return stepPage(savedTokenDeps(telegramDouble({ getUpdates: jsonAnswer(401, FIXTURES.unauthorized) })));
      },
    },
    {
      case: "the step page shows a saved token while TELEGRAM_CHAT_ID is set",
      secrets: [SAVED_TOKEN],
      run: async () => {
        await saveBotToken(SAVED_TOKEN);
        return stepPage(savedTokenDeps(telegramDouble(), { env: TOKEN_CHAT_ENV }));
      },
    },
    {
      case: "the step page shows a damaged saved token",
      secrets: [SAVED_TOKEN],
      run: async () => {
        await saveBotToken(SAVED_TOKEN);
        await damageBotTokenRow();
        return stepPage(savedTokenDeps(telegramDouble()));
      },
    },
    {
      case: "the step page shows the Worker secret",
      secrets: [BOT_TOKEN, SAVED_TOKEN],
      run: async () => {
        await saveBotToken(SAVED_TOKEN);
        return stepPage(telegramDeps(telegramDouble()));
      },
    },
    {
      case: "the step page shows a malformed Worker secret",
      secrets: ["1:a/../setWebhook"],
      run: () =>
        stepPage(
          telegramDeps(telegramDouble(), { env: { SELUNA_SECRET: SECRET, TELEGRAM_BOT_TOKEN: "1:a/../setWebhook" } }),
        ),
    },
    {
      case: "the status page shows a saved token",
      secrets: [SAVED_TOKEN],
      run: async () => {
        await saveBotToken(SAVED_TOKEN);
        return stepPage(savedTokenDeps(telegramDouble()), "/setup");
      },
    },
    {
      case: "the status page shows the Worker secret",
      secrets: [BOT_TOKEN],
      run: () => stepPage(telegramDeps(telegramDouble()), "/setup"),
    },
  ];

  /** The token as written, percent-encoded and as the HTML of a page would write it. */
  function spellings(secret: string): string[] {
    return [secret, encodeURIComponent(secret), escapeHtml(secret), secret.split(":").join("%3A")];
  }

  it.each(SECRECY_CASES)(
    "handleSetup returns the token in no body, header or log entry when $case",
    async ({ secrets, run }) => {
      const logged: unknown[] = [];
      const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          logged.push(args);
        }),
      );

      let response: Response;
      try {
        response = await run();
      } finally {
        for (const spy of spies) {
          spy.mockRestore();
        }
      }

      const body = await response.text();
      const headers = JSON.stringify([...response.headers]);
      const logs = JSON.stringify(logged);
      for (const secret of secrets) {
        for (const spelling of spellings(secret)) {
          expect(body, `body holds ${spelling}`).not.toContain(spelling);
          expect(headers, `headers hold ${spelling}`).not.toContain(spelling);
          expect(logs, `log entries hold ${spelling}`).not.toContain(spelling);
        }
      }
      expect(body.length + headers.length, "an answer was produced").toBeGreaterThan(0);
    },
  );

  it("handleSetup stores a saved token in no table in plain text", async () => {
    const response = await saveToken([NEW_TOKEN], savedTokenDeps(telegramDouble()));

    expect(response.status, "status").toBe(303);
    const rows = await databaseText();
    for (const spelling of spellings(NEW_TOKEN)) {
      expect(rows, `rows hold ${spelling}`).not.toContain(spelling);
    }
    expect(await savedBotToken(), "readable token").toBe(NEW_TOKEN);
  });
});

const ACTIVATE_PATH = "/setup/channel/activate";
const REMOVE_CHANNEL_PATH = "/setup/channel/remove";
const CHANNEL_PATHS = [ACTIVATE_PATH, REMOVE_CHANNEL_PATH];
const TELEGRAM_READY_ENV = {
  SELUNA_SECRET: SECRET,
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  TELEGRAM_CHAT_ID: CHAT_SECRET_VALUE,
};

/** Dependencies with Telegram and `second` registered; `deliveryEnv` is the Worker environment. */
function channelDeps(
  second: TestChannel,
  deliveryEnv: object = TELEGRAM_READY_ENV,
  overrides: Partial<SetupDeps> = {},
): SetupDeps {
  const channels: ChannelList = [TELEGRAM_CHANNEL, second];
  return depsAt(NOW.getTime(), { env: deliveryEnv, channels, ...overrides });
}

/** The fields of a messenger form: a valid session-bound token and one `channel` field per entry. */
async function channelFields(ids: readonly string[]): Promise<FormFields> {
  return [["csrf", await validCsrf()], ...ids.map((id): [string, string] => ["channel", id])];
}

async function activate(ids: readonly string[], deps: SetupDeps): Promise<Response> {
  return postSignedIn(ACTIVATE_PATH, await channelFields(ids), deps);
}

async function removeChannel(ids: readonly string[], deps: SetupDeps): Promise<Response> {
  return postSignedIn(REMOVE_CHANNEL_PATH, await channelFields(ids), deps);
}

async function storedChannel(): Promise<string | undefined> {
  return readSetting(env.DB, DELIVERY_CHANNEL_SETTING);
}

/** The Messengers card of an English start page, or an empty text. */
function messengersCardOf(html: string): string {
  const start = html.indexOf(`<h2>${escapeHtml(TEXTS.en.messengersHeading)}</h2>`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
}

/** The `li` of the Messengers card that links to `path`, or an empty text. */
function messengerItemOf(html: string, path: string): string {
  const items = Array.from(messengersCardOf(html).matchAll(/<li>([\s\S]*?)<\/li>/g), (match) => match[1] ?? "");
  return items.find((item) => item.includes(`href="${path}"`)) ?? "";
}

describe("handleSetup start page Messengers card", () => {
  it("GET /setup shows Telegram as active but not set up with the Set up link, and the Messenger line with (not set up)", async () => {
    const response = await stepPage(depsAt(), "/setup");

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    const item = messengerItemOf(html, "/setup/telegram");
    expect(item, "info notice").toContain(`<p class="notice info">${escapeHtml(TEXTS.en.messengerActiveNotSetUp)}</p>`);
    expect(item, "Set up link").toContain(`>${escapeHtml(TEXTS.en.messengerSetUpLink)}</a>`);
    expect(item, "forms").not.toContain("<form");
    expect(html, "Messenger line").toMatch(
      new RegExp(
        `<p>${escapeHtml(TEXTS.en.messengerLabel)}\\s+Telegram\\s+${escapeRegExp(TEXTS.en.messengerNotSetUpSuffix)}</p>`,
      ),
    );
  });

  it("GET /setup shows Telegram as active without the notice and without Remove when both Worker secrets set it up", async () => {
    const response = await stepPage(channelDeps(testChannel({ configured: false })), "/setup");

    const html = await response.text();
    const item = messengerItemOf(html, "/setup/telegram");
    expect(item, "state").toContain(escapeHtml(TEXTS.en.messengerStateActive));
    expect(item, "info notice").not.toContain("notice info");
    expect(item, "Change link").toContain(`>${escapeHtml(TEXTS.en.messengerChangeLink)}</a>`);
    expect(item, "forms").not.toContain("<form");
    expect(html, "Messenger line").toMatch(new RegExp(`<p>${escapeHtml(TEXTS.en.messengerLabel)}\\s+Telegram</p>`));
  });

  it("GET /setup lists a second messenger that is not set up after Telegram with the Set up link and no form", async () => {
    const html = await (await stepPage(channelDeps(testChannel({ configured: false })), "/setup")).text();

    const item = messengerItemOf(html, "/setup/test");
    expect(item, "state").toContain(escapeHtml(TEXTS.en.messengerStateNotSetUp));
    expect(item, "Set up link").toContain(`>${escapeHtml(TEXTS.en.messengerSetUpLink)}</a>`);
    expect(item, "forms").not.toContain("<form");
    expect(html.indexOf('href="/setup/telegram"'), "registry order").toBeLessThan(html.indexOf('href="/setup/test"'));
  });

  it("GET /setup shows Activate for a set-up second messenger that is not active, and Remove only when it can remove", async () => {
    const plain = await (await stepPage(channelDeps(testChannel({ configured: true })), "/setup")).text();
    const removable = await (
      await stepPage(channelDeps(testChannel({ configured: true, removable: true })), "/setup")
    ).text();

    expect(messengerItemOf(plain, "/setup/test"), "activate form").toContain(`action="${ACTIVATE_PATH}"`);
    expect(messengerItemOf(plain, "/setup/test"), "remove form").not.toContain(`action="${REMOVE_CHANNEL_PATH}"`);
    expect(messengerItemOf(removable, "/setup/test"), "remove form").toContain(`action="${REMOVE_CHANNEL_PATH}"`);
  });

  it("GET /setup shows Remove for Telegram with a saved token, active or not", async () => {
    await saveBotToken(SAVED_TOKEN);
    const deps = channelDeps(testChannel(), { SELUNA_SECRET: SECRET });

    const html = await (await stepPage(deps, "/setup")).text();

    expect(messengerItemOf(html, "/setup/telegram"), "remove form").toContain(`action="${REMOVE_CHANNEL_PATH}"`);
  });

  it("GET /setup shows the second messenger as active and Telegram with Activate when delivery_channel names it", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");

    const html = await (await stepPage(channelDeps(testChannel({ configured: true })), "/setup")).text();

    expect(messengerItemOf(html, "/setup/test"), "second state").toContain(escapeHtml(TEXTS.en.messengerStateActive));
    expect(messengerItemOf(html, "/setup/telegram"), "Telegram activate form").toContain(`action="${ACTIVATE_PATH}"`);
    expect(html, "Messenger line").toMatch(new RegExp(`<p>${escapeHtml(TEXTS.en.messengerLabel)}\\s+test</p>`));
  });

  it("GET /setup shows Telegram as active when the stored delivery_channel names no registered messenger", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "gone");

    const html = await (await stepPage(channelDeps(testChannel({ configured: true })), "/setup")).text();

    expect(messengerItemOf(html, "/setup/telegram"), "Telegram state").toContain(
      escapeHtml(TEXTS.en.messengerStateActive),
    );
    expect(messengerItemOf(html, "/setup/telegram"), "no Activate for the active one").not.toContain("<form");
    expect(html, "Messenger line").toMatch(new RegExp(`<p>${escapeHtml(TEXTS.en.messengerLabel)}\\s+Telegram</p>`));
  });

  it("GET /setup puts the Messengers card after the status section and before the step links", async () => {
    const html = await (await stepPage(depsAt(), "/setup")).text();

    expect(html.indexOf(escapeHtml(TEXTS.en.statusHeading)), "status before messengers").toBeLessThan(
      html.indexOf(escapeHtml(TEXTS.en.messengersHeading)),
    );
    expect(html.indexOf(escapeHtml(TEXTS.en.messengersHeading)), "messengers before the settings").toBeLessThan(
      html.indexOf(escapeHtml(TEXTS.en.settingsHeading)),
    );
  });
});

describe("handleSetup POST /setup/channel/activate", () => {
  it("POST /setup/channel/activate activates a set-up channel and answers 303 to /setup", async () => {
    const second = testChannel({ configured: true });

    const response = await activate(["test"], channelDeps(second));

    expect(response.status, "status").toBe(303);
    expect(response.headers.get("Location"), "Location").toBe("/setup");
    expect(await storedChannel(), "stored channel").toBe("test");
  });

  it("POST /setup/channel/activate makes the start page show the activated messenger as active", async () => {
    const deps = channelDeps(testChannel({ configured: true }));
    await activate(["test"], deps);

    const html = await (await stepPage(deps, "/setup")).text();

    expect(messengerItemOf(html, "/setup/test"), "state").toContain(escapeHtml(TEXTS.en.messengerStateActive));
    expect(html, "Messenger line").toMatch(new RegExp(`<p>${escapeHtml(TEXTS.en.messengerLabel)}\\s+test</p>`));
  });

  it("POST /setup/channel/activate activates Telegram again when it is set up", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");

    const response = await activate(["telegram"], channelDeps(testChannel()));

    expect(response.status, "status").toBe(303);
    expect(await storedChannel(), "stored channel").toBe("telegram");
  });

  it("POST /setup/channel/activate answers 303 and changes nothing for the channel that is already active", async () => {
    const response = await activate(["telegram"], channelDeps(testChannel({ configured: true })));

    expect(response.status, "status").toBe(303);
    expect(response.headers.get("Location"), "Location").toBe("/setup");
    expect(await storedChannel(), "stored channel").toBeUndefined();
  });

  it("POST /setup/channel/activate answers 409 messenger-not-set-up for a channel that is not set up and keeps the active one", async () => {
    const response = await activate(["test"], channelDeps(testChannel({ configured: false })));

    expect(response.status, "status").toBe(409);
    const html = await response.text();
    expectStartPage(html);
    expect(html, "notice").toContain(noticeText("messenger-not-set-up"));
    expect(html, "status heading").toContain(escapeHtml(TEXTS.en.statusHeading));
    expect(await storedChannel(), "stored channel").toBeUndefined();
  });

  it("POST /setup/channel/activate answers 409 for Telegram without a bot token and keeps the active channel", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");

    const response = await activate(["telegram"], channelDeps(testChannel(), { SELUNA_SECRET: SECRET }));

    expect(response.status, "status").toBe(409);
    expect(await response.text(), "notice").toContain(noticeText("messenger-not-set-up"));
    expect(await storedChannel(), "stored channel").toBe("test");
  });

  it.each([
    { case: "missing", ids: [] as readonly string[] },
    { case: "empty", ids: [""] },
    { case: "unknown", ids: ["gotify"] },
    { case: "upper-case", ids: ["TELEGRAM"] },
    { case: "padded", ids: [" test"] },
    { case: "a path", ids: ["../telegram"] },
    { case: "repeated", ids: ["test", "test"] },
    { case: "two ids", ids: ["telegram", "test"] },
  ])("POST /setup/channel/activate answers 400 messenger-invalid when the channel field is $case", async ({ ids }) => {
    const response = await activate(ids, channelDeps(testChannel({ configured: true })));

    expect(response.status, "status").toBe(400);
    const html = await response.text();
    expectStartPage(html);
    expect(html, "notice").toContain(noticeText("messenger-invalid"));
    expect(await storedChannel(), "stored channel").toBeUndefined();
  });

  it("POST /setup/channel/activate keeps the last write when two requests activate different channels", async () => {
    const first = testChannel({ id: "first", configured: true });
    const second = testChannel({ id: "second", configured: true });
    const deps = depsAt(NOW.getTime(), { env: TELEGRAM_READY_ENV, channels: [TELEGRAM_CHANNEL, first, second] });

    const responses = await Promise.all([activate(["first"], deps), activate(["second"], deps)]);

    expect(
      responses.map((response) => response.status),
      "statuses",
    ).toEqual([303, 303]);
    expect(["first", "second"], "the stored channel is one of the two").toContain(await storedChannel());
  });
});

describe("handleSetup POST /setup/channel/remove", () => {
  it("POST /setup/channel/remove deletes the saved bot token and answers 303 to /setup", async () => {
    await saveBotToken(SAVED_TOKEN);
    await writeSetting(env.DB, TELEGRAM_CHAT_ID_SETTING, "5001001");
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");

    const response = await removeChannel(["telegram"], channelDeps(testChannel(), { SELUNA_SECRET: SECRET }));

    expect(response.status, "status").toBe(303);
    expect(response.headers.get("Location"), "Location").toBe("/setup");
    expect(await savedBotToken(), "saved token").toBeUndefined();
    expect(await readSetting(env.DB, TELEGRAM_CHAT_ID_SETTING), "saved chat stays").toBe("5001001");
    expect(await storedChannel(), "stored channel stays").toBe("test");
  });

  it("POST /setup/channel/remove deletes the saved bot token of the active Telegram, which stays active", async () => {
    await saveBotToken(SAVED_TOKEN);
    const deps = channelDeps(testChannel(), { SELUNA_SECRET: SECRET, TELEGRAM_CHAT_ID: CHAT_SECRET_VALUE });

    const response = await removeChannel(["telegram"], deps);

    expect(response.status, "status").toBe(303);
    expect(await savedBotToken(), "saved token").toBeUndefined();
    const html = await (await stepPage(deps, "/setup")).text();
    expect(messengerItemOf(html, "/setup/telegram"), "info notice").toContain(
      `<p class="notice info">${escapeHtml(TEXTS.en.messengerActiveNotSetUp)}</p>`,
    );
  });

  it("POST /setup/channel/remove answers 303 and deletes nothing when nothing is saved", async () => {
    await saveGitHubCredentials();

    const response = await removeChannel(["telegram"], channelDeps(testChannel(), { SELUNA_SECRET: SECRET }));

    expect(response.status, "status").toBe(303);
    expect(await secretsCount(), "secrets rows: the GitHub credentials stay").toBe(3);
  });

  it("POST /setup/channel/remove answers 409 messenger-worker-secrets with TELEGRAM_BOT_TOKEN set and deletes nothing", async () => {
    await saveBotToken(SAVED_TOKEN);

    const response = await removeChannel(["telegram"], channelDeps(testChannel()));

    expect(response.status, "status").toBe(409);
    const html = await response.text();
    expectStartPage(html);
    expect(html, "notice").toContain(noticeText("messenger-worker-secrets"));
    expect(await savedBotToken(), "saved token stays").toBe(SAVED_TOKEN);
  });

  it("POST /setup/channel/remove answers 409 telegram-token-unreadable for a token saved under another SELUNA_SECRET and deletes nothing", async () => {
    await saveBotToken(SAVED_TOKEN, OTHER_SECRET);

    const response = await removeChannel(["telegram"], channelDeps(testChannel(), { SELUNA_SECRET: SECRET }));

    expect(response.status, "status").toBe(409);
    const html = await response.text();
    expectStartPage(html);
    expect(html, "notice").toContain(noticeText("telegram-token-unreadable"));
    expect(await secretsCount(), "secrets rows").toBe(1);
  });

  it("POST /setup/channel/remove removes through the channel's own step and answers 303", async () => {
    const second = testChannel({ configured: true, removable: true, removeResult: "removed" });

    const response = await removeChannel(["test"], channelDeps(second));

    expect(response.status, "status").toBe(303);
    expect(response.headers.get("Location"), "Location").toBe("/setup");
    expect(second.removeCalls(), "remove calls").toBe(1);
  });

  it.each([
    { removeResult: "worker-secret", notice: "messenger-worker-secrets" },
    { removeResult: "unreadable", notice: "telegram-token-unreadable" },
  ] as const)(
    "POST /setup/channel/remove answers 409 $notice when the channel refuses with $removeResult",
    async ({ removeResult, notice }) => {
      const second = testChannel({ configured: true, removable: true, removeResult });

      const response = await removeChannel(["test"], channelDeps(second));

      expect(response.status, "status").toBe(409);
      expect(await response.text(), "notice").toContain(noticeText(notice));
    },
  );

  it.each([
    { case: "missing", ids: [] as readonly string[] },
    { case: "empty", ids: [""] },
    { case: "unknown", ids: ["gotify"] },
    { case: "upper-case", ids: ["Telegram"] },
    { case: "padded", ids: ["telegram "] },
    { case: "a path", ids: ["../telegram"] },
    { case: "repeated", ids: ["telegram", "telegram"] },
  ])(
    "POST /setup/channel/remove answers 400 messenger-invalid when the channel field is $case and deletes nothing",
    async ({ ids }) => {
      await saveBotToken(SAVED_TOKEN);
      const second = testChannel({ configured: true, removable: true });

      const response = await removeChannel(ids, channelDeps(second, { SELUNA_SECRET: SECRET }));

      expect(response.status, "status").toBe(400);
      const html = await response.text();
      expectStartPage(html);
      expect(html, "notice").toContain(noticeText("messenger-invalid"));
      expect(await savedBotToken(), "saved token stays").toBe(SAVED_TOKEN);
      expect(second.removeCalls(), "remove calls").toBe(0);
    },
  );
});

describe("handleSetup messenger forms: protection", () => {
  it.each(
    CHANNEL_PATHS.flatMap((path) =>
      CSRF_FAILURES.map((failure) => ({ path, token: failure.name, tokens: failure.tokens })),
    ),
  )("POST $path rejects $token with 403 and changes nothing", async ({ path, tokens: tokensOf }) => {
    await saveBotToken(SAVED_TOKEN);
    const second = testChannel({ configured: true, removable: true });
    const fields: FormFields = [
      ...(await tokensOf()).map((token): [string, string] => ["csrf", token]),
      ["channel", "test"],
    ];

    const response = await postSignedIn(path, fields, channelDeps(second, { SELUNA_SECRET: SECRET }));

    expect(response.status, "status").toBe(403);
    const html = await response.text();
    expectStartPage(html);
    expect(html, "notice").toContain(noticeText("form-expired"));
    expect(html, "settings form").not.toContain('action="/setup/settings"');
    expect(await storedChannel(), "stored channel").toBeUndefined();
    expect(second.removeCalls(), "remove calls").toBe(0);
    expect(await savedBotToken(), "saved token stays").toBe(SAVED_TOKEN);
  });

  it.each(CHANNEL_PATHS)("POST %s answers a body over 1 MiB with 413 and an empty body", async (path) => {
    const response = await call(path, {
      method: "POST",
      cookies: await signedInCookies(),
      body: "a".repeat(MAX_BODY_BYTES + 1),
    });

    expect(response.status, "status").toBe(413);
    expect(await response.text(), "body").toBe("");
  });

  it.each(CHANNEL_PATHS)("POST %s answers an unreadable body with 400 and an empty body", async (path) => {
    const unreadable = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("connection lost"));
      },
    });

    const response = await call(path, { method: "POST", cookies: await signedInCookies(), body: unreadable });

    expect(response.status, "status").toBe(400);
    expect(await response.text(), "body").toBe("");
  });

  it.each(CHANNEL_PATHS)("POST %s answers an empty form with 403 and the form expired notice", async (path) => {
    const response = await call(path, { method: "POST", cookies: await signedInCookies(), body: "" });

    expect(response.status, "status").toBe(403);
    expect(await response.text(), "notice").toContain(noticeText("form-expired"));
  });

  it.each(CHANNEL_PATHS)("POST %s without a session answers the login page and changes nothing", async (path) => {
    const response = await call(
      path,
      { method: "POST", body: form([["channel", "test"]]) },
      depsAt(NOW.getTime(), { db: unusedDb() }),
    );

    expect(response.status, "status").toBe(200);
    expectLoginPage(await response.text());
  });

  it.each(CHANNEL_PATHS)("GET %s answers 404 when signed in", async (path) => {
    const response = await call(path, { cookies: await signedInCookies() });

    expect(response.status, "status").toBe(404);
    expect(await response.text(), "body").toBe("");
  });

  it.each(CHANNEL_PATHS)("POST %s answers 503 with the unavailable notice when D1 fails", async (path) => {
    const second = testChannel({ configured: true, removable: true });

    const response = await postSignedIn(
      path,
      await channelFields(["telegram"]),
      channelDeps(second, { SELUNA_SECRET: SECRET }, { db: migrationTestDb() }),
    );

    expect(response.status, "status").toBe(503);
    const html = await response.text();
    expect(html, "unavailable notice").toContain(noticeText("unavailable"));
    expect(html.toLowerCase(), "error text").not.toContain("no such table");
  });
});

describe("handleSetup Telegram step notice for an active Telegram that is not set up", () => {
  const NOTICE = `<p class="notice info">${escapeHtml(TEXTS.en.telegramActiveNotSetUp)}</p>`;

  it("GET /setup/telegram shows the Telegram active, not set up notice above the token card while Telegram is active without a token", async () => {
    const html = await (await stepPage(depsAt())).text();

    expect(html, "notice").toContain(NOTICE);
    expect(html.indexOf(NOTICE), "above the token form").toBeLessThan(
      html.indexOf(escapeHtml(TEXTS.en.telegramTokenIntro)),
    );
  });

  it("GET /setup/telegram shows the notice while Telegram is active with a token and without a chat", async () => {
    const html = await (await stepPage(telegramDeps(telegramDouble()))).text();

    expect(html, "notice").toContain(NOTICE);
  });

  it("GET /setup/telegram shows the notice when the stored channel names no registered messenger", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "gone");

    const html = await (await stepPage(channelDeps(testChannel(), { SELUNA_SECRET: SECRET }), STEP_PATH)).text();

    expect(html, "notice").toContain(NOTICE);
  });

  it("POST /setup/telegram/token/remove answers 303 to the step, which then shows the notice while Telegram is active", async () => {
    await saveBotToken(SAVED_TOKEN);
    const deps = savedTokenDeps(telegramDouble());

    const response = await removeToken(deps);
    const html = await (await stepPage(deps)).text();

    expect(response.status, "status").toBe(303);
    expect(response.headers.get("Location"), "Location").toBe(STEP_PATH);
    expect(html, "notice").toContain(NOTICE);
  });
});

describe("handleSetup Telegram step notice: negatives", () => {
  const NOTICE = `<p class="notice info">${escapeHtml(TEXTS.en.telegramActiveNotSetUp)}</p>`;

  it("GET /setup/telegram shows no notice while Telegram is active and set up", async () => {
    const html = await (await stepPage(chatSecretDeps(telegramDouble()))).text();

    expect(html, "notice").not.toContain(NOTICE);
  });

  it("GET /setup/telegram shows no notice while another messenger is active and Telegram is not set up", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");

    const html = await (
      await stepPage(channelDeps(testChannel({ configured: true }), { SELUNA_SECRET: SECRET }), STEP_PATH)
    ).text();

    expect(html, "notice").not.toContain(NOTICE);
  });

  it("GET /setup/telegram shows the step without the notice when reading the active messenger fails", async () => {
    const failing: D1Database = {
      prepare: (query: string) => {
        if (query.includes("settings")) {
          throw new Error("The database failed");
        }
        return env.DB.prepare(query);
      },
      batch: (statements) => env.DB.batch(statements),
      exec: () => Promise.reject(new Error("Not supported by this wrapper")),
      dump: () => Promise.reject(new Error("Not supported by this wrapper")),
      withSession: () => {
        throw new Error("Not supported by this wrapper");
      },
    };

    const response = await stepPage(chatSecretDeps(telegramDouble(), { db: failing }));

    expect(response.status, "status").toBe(200);
    const html = await response.text();
    expect(html, "notice").not.toContain(NOTICE);
    expect(html, "token card").toContain(escapeHtml(TEXTS.en.telegramTokenHeading));
  });
});

describe("handleSetup settings form and delivery_channel", () => {
  it("POST /setup/settings leaves delivery_channel unchanged", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");

    const response = await postSignedIn(SETTINGS_PATH, await settingsFormFields(), depsAt());

    expect(response.status, "status").toBe(303);
    expect(await storedChannel(), "stored channel").toBe("test");
  });

  it("POST /setup/settings ignores a delivery_channel field", async () => {
    const response = await postSignedIn(
      SETTINGS_PATH,
      await settingsFormFields([["delivery_channel", "test"]]),
      depsAt(),
    );

    expect(response.status, "status").toBe(303);
    expect(await storedChannel(), "stored channel").toBeUndefined();
  });

  it("GET /setup shows the settings form without a delivery_channel field", async () => {
    const html = await (await stepPage(depsAt(), "/setup")).text();

    expect(html, "settings form").toContain('action="/setup/settings"');
    expect(html, "delivery_channel").not.toContain("delivery_channel");
  });

  it("GET /setup shows no Remove for Telegram while TELEGRAM_BOT_TOKEN is set although a token is saved", async () => {
    await saveBotToken(SAVED_TOKEN);

    const html = await (await stepPage(channelDeps(testChannel()), "/setup")).text();

    expect(messengerItemOf(html, "/setup/telegram"), "item").not.toBe("");
    expect(messengerItemOf(html, "/setup/telegram"), "remove form").not.toContain(`action="${REMOVE_CHANNEL_PATH}"`);
  });
});
