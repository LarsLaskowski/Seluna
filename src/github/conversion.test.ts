import { describe, expect, it } from "vitest";
import {
  convertManifestCode,
  GITHUB_API_VERSION,
  isAppOwner,
  isManifestCode,
  MAX_GITHUB_RESPONSE_BYTES,
  MAX_OWNER_LOGIN_CHARACTERS,
  MAX_PEM_CHARACTERS,
  MAX_WEBHOOK_SECRET_CHARACTERS,
  parseConversion,
} from "./conversion";
import type { AppOwner } from "./conversion";
import type { AccountChoice } from "./manifest";
import {
  conversionAnswer,
  conversionOwnedBy,
  FIXTURE_CLIENT_SECRET,
  FIXTURE_CODE,
  FIXTURE_PEM,
  FIXTURE_WEBHOOK_SECRET,
  FIXTURES,
  githubDouble,
  jsonAnswer,
} from "../../test/github";
import type { GitHubAnswer } from "../../test/github";

const VERSION = "1.2.3";

/** The codes the allow-list `^[A-Za-z0-9_-]{1,100}$` rejects. */
const REJECTED_CODES = [
  { form: "empty", code: "" },
  { form: "101 characters", code: "a".repeat(101) },
  { form: "dot dot", code: ".." },
  { form: "dot", code: "." },
  { form: "slash", code: "a/b" },
  { form: "backslash", code: "a\\b" },
  { form: "encoded dot dot", code: "%2e%2e" },
  { form: "encoded slash", code: "a%2Fb" },
  { form: "question mark", code: "a?b" },
  { form: "number sign", code: "a#b" },
  { form: "space", code: "a b" },
  { form: "plus", code: "a+b" },
  { form: "equals sign", code: "a=b" },
  { form: "umlaut", code: "ä" },
  { form: "trailing line feed", code: "a\n" },
];

describe("isManifestCode", () => {
  it.each([{ code: FIXTURE_CODE }, { code: "A-_9" }, { code: "a" }, { code: "a".repeat(100) }])(
    "isManifestCode accepts $code",
    ({ code }) => {
      const accepted = isManifestCode(code);

      expect(accepted, "accepted").toBe(true);
    },
  );

  it.each(REJECTED_CODES)("isManifestCode rejects every form in the guard table: $form", ({ code }) => {
    const accepted = isManifestCode(code);

    expect(accepted, "accepted").toBe(false);
  });
});

describe("convertManifestCode request", () => {
  it("convertManifestCode posts to the conversions endpoint without credentials and with the API headers", async () => {
    const github = githubDouble();

    await convertManifestCode(FIXTURE_CODE, VERSION, github.fetch);

    expect(github.requests.length, "number of requests").toBe(1);
    const [request] = github.requests;
    expect(request?.method, "method").toBe("POST");
    expect(request?.url, "url").toBe(`https://api.github.com/app-manifests/${FIXTURE_CODE}/conversions`);
    expect(request?.headers.get("accept"), "Accept").toBe("application/vnd.github+json");
    expect(request?.headers.get("x-github-api-version"), "X-GitHub-Api-Version").toBe("2022-11-28");
    expect(GITHUB_API_VERSION, "GITHUB_API_VERSION").toBe("2022-11-28");
    expect(request?.headers.get("user-agent"), "User-Agent").toBe(`seluna/${VERSION}`);
    expect(request?.headers.get("authorization"), "Authorization").toBeNull();
    expect(request?.hasBody, "has a body").toBe(false);
    expect(request?.redirect, "redirect mode").toBe("manual");
    expect(request?.signal.aborted, "signal already aborted").toBe(false);
    expect(request?.signal, "signal").toBeInstanceOf(AbortSignal);
  });

  it.each(REJECTED_CODES)(
    "convertManifestCode makes no call for a code outside the allow-list and reports it as rejected: $form",
    async ({ code }) => {
      const github = githubDouble();

      const result = await convertManifestCode(code, VERSION, github.fetch);

      expect(result, "result").toEqual({ kind: "rejected" });
      expect(github.requests, "requests").toEqual([]);
    },
  );
});

describe("convertManifestCode answers", () => {
  it("convertManifestCode narrows the documented answer to app id, owner, slug, pem and webhook secret", async () => {
    const github = githubDouble();

    const result = await convertManifestCode(FIXTURE_CODE, VERSION, github.fetch);

    expect(result, "result").toEqual({
      kind: "converted",
      app: {
        appId: 1,
        owner: { login: "github", type: "User" },
        slug: "octoapp",
        pem: FIXTURE_PEM,
        webhookSecret: FIXTURE_WEBHOOK_SECRET,
      },
    });
    expect(JSON.stringify(result), "client secret in the result").not.toContain(FIXTURE_CLIENT_SECRET);
  });

  it.each([
    { name: "404", answer: jsonAnswer(404, FIXTURES.notFound) },
    { name: "422", answer: jsonAnswer(422, FIXTURES.validationFailed) },
  ])("convertManifestCode reports $name as rejected", async ({ answer }) => {
    const github = githubDouble(answer);

    const result = await convertManifestCode(FIXTURE_CODE, VERSION, github.fetch);

    expect(result, "result").toEqual({ kind: "rejected" });
  });

  it.each<{ name: string; answer: GitHubAnswer }>([
    { name: "a rejected fetch", answer: { kind: "reject", error: new Error("connection lost") } },
    {
      name: "an aborted fetch",
      answer: { kind: "reject", error: new DOMException("The operation timed out", "TimeoutError") },
    },
    {
      name: "status 302",
      answer: { kind: "raw", status: 302, body: null, headers: { location: "https://example.com/" } },
    },
    { name: "status 401", answer: jsonAnswer(401, { message: "Bad credentials" }) },
    { name: "status 500", answer: jsonAnswer(500, { message: "Server Error" }) },
  ])("convertManifestCode reports $name as unavailable", async ({ answer }) => {
    const github = githubDouble(answer);

    const result = await convertManifestCode(FIXTURE_CODE, VERSION, github.fetch);

    expect(result, "result").toEqual({ kind: "unavailable" });
  });

  it.each([{ status: 404 }, { status: 422 }, { status: 500 }])(
    "convertManifestCode cancels the body of a $status answer unread",
    async ({ status }) => {
      let pulled = false;
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>(
        {
          pull() {
            pulled = true;
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      );
      const github = githubDouble({ kind: "raw", status, body });

      await convertManifestCode(FIXTURE_CODE, VERSION, github.fetch);

      expect(cancelled, "body cancelled").toBe(true);
      expect(pulled, "body read").toBe(false);
    },
  );

  const OVERSIZED = `{"pad":"${"a".repeat(MAX_GITHUB_RESPONSE_BYTES)}"}`;
  it.each<{ name: string; answer: GitHubAnswer }>([
    { name: "a body above 1 MiB", answer: { kind: "raw", status: 201, body: OVERSIZED } },
    {
      name: "a body that is not UTF-8",
      answer: { kind: "raw", status: 201, body: new Uint8Array([0x22, 0xff, 0x22]) },
    },
    { name: "a body that is not JSON", answer: { kind: "raw", status: 201, body: "not json" } },
    { name: "an empty body", answer: { kind: "raw", status: 201, body: "" } },
    { name: "a JSON array", answer: jsonAnswer(201, []) },
    { name: "JSON null", answer: jsonAnswer(201, null) },
    { name: "a null webhook secret", answer: jsonAnswer(201, conversionAnswer({ webhook_secret: null })) },
    { name: "an empty webhook secret", answer: jsonAnswer(201, conversionAnswer({ webhook_secret: "" })) },
    { name: "a missing webhook secret", answer: jsonAnswer(201, conversionAnswer({ webhook_secret: undefined })) },
    {
      name: "a webhook secret above 1,024 characters",
      answer: jsonAnswer(201, conversionAnswer({ webhook_secret: "a".repeat(MAX_WEBHOOK_SECRET_CHARACTERS + 1) })),
    },
    { name: "a missing pem", answer: jsonAnswer(201, conversionAnswer({ pem: undefined })) },
    { name: "a pem that is not a string", answer: jsonAnswer(201, conversionAnswer({ pem: 42 })) },
    {
      name: "a pem above 16,384 characters",
      answer: jsonAnswer(201, conversionAnswer({ pem: "a".repeat(MAX_PEM_CHARACTERS + 1) })),
    },
    { name: "a missing id", answer: jsonAnswer(201, conversionAnswer({ id: undefined })) },
    { name: "an id of zero", answer: jsonAnswer(201, conversionAnswer({ id: 0 })) },
    { name: "a negative id", answer: jsonAnswer(201, conversionAnswer({ id: -1 })) },
    { name: "a fractional id", answer: jsonAnswer(201, conversionAnswer({ id: 1.5 })) },
    { name: "an id above the safe integers", answer: jsonAnswer(201, conversionAnswer({ id: 2 ** 53 })) },
    { name: "an id that is a string", answer: jsonAnswer(201, conversionAnswer({ id: "1" })) },
    { name: "a missing owner", answer: jsonAnswer(201, conversionAnswer({ owner: undefined })) },
    { name: "an owner that is null", answer: jsonAnswer(201, conversionAnswer({ owner: null })) },
    {
      name: "an owner without login and type (an enterprise)",
      answer: jsonAnswer(201, conversionAnswer({ owner: { id: 3, slug: "enterprise", name: "Enterprise" } })),
    },
    {
      name: "an owner without a string login",
      answer: jsonAnswer(201, conversionAnswer({ owner: { login: 7, type: "User" } })),
    },
    { name: "an owner without a type", answer: jsonAnswer(201, conversionAnswer({ owner: { login: "github" } })) },
    {
      name: "an owner with a type that is not a string",
      answer: jsonAnswer(201, conversionAnswer({ owner: { login: "github", type: 1 } })),
    },
    {
      name: "an owner login of 40 characters",
      answer: jsonAnswer(201, conversionOwnedBy("a".repeat(MAX_OWNER_LOGIN_CHARACTERS + 1), "User")),
    },
  ])("convertManifestCode reports $name in a 2xx answer as malformed", async ({ answer }) => {
    const github = githubDouble(answer);

    const result = await convertManifestCode(FIXTURE_CODE, VERSION, github.fetch);

    expect(result, "result").toEqual({ kind: "malformed" });
  });
});

describe("parseConversion", () => {
  it.each([
    { name: "uppercase letters", slug: "Octo-App", expected: undefined },
    { name: "an empty text", slug: "", expected: undefined },
    { name: "a dot", slug: ".", expected: undefined },
    { name: "a slash", slug: "a/b", expected: undefined },
    { name: "a percent sign", slug: "a%2fb", expected: undefined },
    { name: "101 characters", slug: "a".repeat(101), expected: undefined },
    { name: "a number", slug: 42, expected: undefined },
    { name: "lowercase letters, digits and hyphens", slug: "octo-app-2", expected: "octo-app-2" },
    { name: "100 characters", slug: "a".repeat(100), expected: "a".repeat(100) },
  ])("parseConversion leaves out a slug outside the allow-list: $name", ({ slug, expected }) => {
    const app = parseConversion(conversionAnswer({ slug }));

    expect(app?.slug, "slug").toBe(expected);
    expect(app?.appId, "the rest of the app is kept").toBe(1);
  });

  it("parseConversion leaves out a missing slug", () => {
    const app = parseConversion(conversionAnswer({ slug: undefined }));

    expect(app?.slug, "slug").toBeUndefined();
    expect(app?.webhookSecret, "the rest of the app is kept").toBe(FIXTURE_WEBHOOK_SECRET);
  });
});

describe("isAppOwner", () => {
  const PERSONAL_GITHUB: AccountChoice = { type: "personal", account: "github" };
  const ORGANIZATION_GITHUB: AccountChoice = { type: "organization", account: "github" };

  it.each<{ name: string; owner: AppOwner; choice: AccountChoice }>([
    { name: "the same login of a user", owner: { login: "github", type: "User" }, choice: PERSONAL_GITHUB },
    { name: "the login in capitals of a user", owner: { login: "GITHUB", type: "User" }, choice: PERSONAL_GITHUB },
    {
      name: "the login in lowercase for an account in capitals",
      owner: { login: "github", type: "User" },
      choice: { type: "personal", account: "GitHub" },
    },
    {
      name: "the same login of an organization",
      owner: { login: "github", type: "Organization" },
      choice: ORGANIZATION_GITHUB,
    },
    {
      name: "the login in another case of an organization",
      owner: { login: "GitHub", type: "Organization" },
      choice: ORGANIZATION_GITHUB,
    },
  ])(
    "isAppOwner accepts the account of the state in any ASCII letter case and the matching owner type only: $name",
    ({ owner, choice }) => {
      const accepted = isAppOwner(owner, choice);

      expect(accepted, "accepted").toBe(true);
    },
  );

  it.each<{ name: string; owner: AppOwner; choice: AccountChoice }>([
    { name: "another login", owner: { login: "octocat", type: "User" }, choice: PERSONAL_GITHUB },
    {
      name: "the login with a trailing line feed",
      owner: { login: "github\n", type: "User" },
      choice: PERSONAL_GITHUB,
    },
    {
      name: "a login of 40 characters",
      owner: { login: "a".repeat(40), type: "User" },
      choice: { type: "personal", account: "a".repeat(39) },
    },
    {
      name: "an organization for a personal account",
      owner: { login: "github", type: "Organization" },
      choice: PERSONAL_GITHUB,
    },
    { name: "a user for an organization", owner: { login: "github", type: "User" }, choice: ORGANIZATION_GITHUB },
    { name: "the type user in lowercase", owner: { login: "github", type: "user" }, choice: PERSONAL_GITHUB },
    {
      name: "the type organization in lowercase",
      owner: { login: "github", type: "organization" },
      choice: ORGANIZATION_GITHUB,
    },
    { name: "the type Bot", owner: { login: "github", type: "Bot" }, choice: PERSONAL_GITHUB },
    { name: "an empty type", owner: { login: "github", type: "" }, choice: PERSONAL_GITHUB },
    { name: "an empty login", owner: { login: "", type: "User" }, choice: PERSONAL_GITHUB },
  ])("isAppOwner rejects every form in the owner table: $name", ({ owner, choice }) => {
    const accepted = isAppOwner(owner, choice);

    expect(accepted, "accepted").toBe(false);
  });

  it("isAppOwner rejects the Kelvin sign login for the account kelvin", () => {
    const login = "\u212Aelvin";
    expect(login.charCodeAt(0), "first code unit of the login").toBe(0x21_2a);

    const accepted = isAppOwner({ login, type: "User" }, { type: "personal", account: "kelvin" });

    expect(accepted, "accepted").toBe(false);
  });

  it("isAppOwner rejects a login with a trailing line feed as a line feed and not as the plain login", () => {
    const login = "github\n";
    expect(login.charCodeAt(login.length - 1), "last code unit of the login").toBe(0x0a);

    const accepted = isAppOwner({ login, type: "Organization" }, ORGANIZATION_GITHUB);

    expect(accepted, "accepted").toBe(false);
  });
});
