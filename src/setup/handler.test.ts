import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_BODY_BYTES } from "../body";
import { LOGIN_ATTEMPTS_META_KEY, LOGIN_LOCK_MS } from "../store/login-attempts";
import { CSRF_COOKIE, csrfTokenFor, sessionCsrfTokenFor } from "./csrf";
import { handleSetup, isSetupPath } from "./handler";
import type { SetupDeps } from "./handler";
import { contentSecurityPolicy, escapeHtml } from "./pages";
import { createSessionToken, SESSION_COOKIE, SESSION_LIFETIME_MS } from "./session";
import { TEXTS } from "./texts";
import type { Notice } from "./texts";
import { applyMigrations, migrationTestDb } from "../../test/d1";
import { signingKeyFor, withFirstCharacterChanged } from "../../test/keys";

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
});

/** Setup dependencies with a usable `SELUNA_SECRET`, the real database and a clock fixed at `milliseconds`. */
function depsAt(milliseconds = NOW.getTime(), overrides: Partial<SetupDeps> = {}): SetupDeps {
  return { env: { SELUNA_SECRET: SECRET }, db: env.DB, now: () => new Date(milliseconds), ...overrides };
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
