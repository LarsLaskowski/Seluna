import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_BODY_BYTES } from "../body";
import { LOGIN_ATTEMPTS_META_KEY, LOGIN_LOCK_MS } from "../store/login-attempts";
import { CSRF_COOKIE, csrfTokenFor, sessionCsrfTokenFor } from "./csrf";
import { createChatProof } from "./chat-proof";
import { handleSetup, isSetupPath } from "./handler";
import type { SetupDeps } from "./handler";
import { contentSecurityPolicy, escapeHtml } from "./pages";
import { createSessionToken, SESSION_COOKIE, SESSION_LIFETIME_MS } from "./session";
import { TEXTS } from "./texts";
import type { Notice } from "./texts";
import { applyMigrations, migrationTestDb } from "../../test/d1";
import { signingKeyFor, withFirstCharacterChanged } from "../../test/keys";
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
