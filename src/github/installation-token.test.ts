import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_GITHUB_RESPONSE_BYTES } from "./conversion";
import {
  installationToken,
  parseInstallationToken,
  TOKEN_RENEWAL_MARGIN_MS,
} from "./installation-token";
import type { TokenDeps } from "./installation-token";
import { applyMigrations, migrationTestDb, writeFailingDb } from "../../test/d1";
import { FIXTURE_TOKEN, githubApiDouble, installationTokenBody, jsonAnswer, REJECTED } from "../../test/github";
import type { GitHubAnswer, GitHubDouble } from "../../test/github";
import { bearerOf, decodeJwt, fixtureSigningKey, jwtVerifies } from "../../test/jwt";
import { keyFor } from "../../test/keys";
import { seedCachedToken, tokenOfRow, tokenRowOf, tokenRows } from "../../test/token-cache";

const SECRET = "throwaway-setup-secret-0123456789abcdef";
const OTHER_SECRET = "another-throwaway-secret-fedcba9876543210";
const VERSION = "1.2.3-test";
const APP_ID = 12_345;
const INSTALLATION = 1_000_003;
const OTHER_INSTALLATION = 2_000_004;
const NOW = new Date("2026-10-19T12:00:00Z");
const HOUR_MS = 3_600_000;
const FRESH_EXPIRY = NOW.getTime() + HOUR_MS;
const NEW_TOKEN = "ghs_NewlyIssuedToken0123456789";

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.prepare("DELETE FROM token_cache").run();
});

async function depsFor(github: GitHubDouble, overrides: Partial<TokenDeps> = {}): Promise<TokenDeps> {
  return {
    db: env.DB,
    storageKey: await keyFor(SECRET),
    fetcher: github.fetch,
    now: () => NOW,
    version: VERSION,
    ...overrides,
  };
}

async function credentials(): Promise<{ readonly appId: number; readonly signingKey: CryptoKey }> {
  return { appId: APP_ID, signingKey: await fixtureSigningKey() };
}

/** A double whose token route answers 201 with `token`, expiring one hour after `NOW`. */
function issuingDouble(token = NEW_TOKEN): GitHubDouble {
  return githubApiDouble({ installationToken: jsonAnswer(201, installationTokenBody(token, FRESH_EXPIRY)) });
}

describe("parseInstallationToken", () => {
  const BEFORE = new Date("2016-07-11T20:00:00Z");

  it("parseInstallationToken narrows the documented answer to its token and expiry", () => {
    const parsed = parseInstallationToken(
      installationTokenBody(FIXTURE_TOKEN, Date.parse("2016-07-11T22:14:10Z")),
      BEFORE,
    );

    expect(parsed, "narrowed answer").toEqual({ token: FIXTURE_TOKEN, expiresAt: Date.parse("2016-07-11T22:14:10Z") });
  });

  it.each([
    {
      case: "fractional seconds",
      expiresAt: "2016-07-11T22:14:10.123Z",
      expected: Date.parse("2016-07-11T22:14:10.123Z"),
    },
    { case: "a positive offset", expiresAt: "2016-07-11T22:14:10+02:00", expected: Date.parse("2016-07-11T20:14:10Z") },
    { case: "a negative offset", expiresAt: "2016-07-11T22:14:10-05:00", expected: Date.parse("2016-07-12T03:14:10Z") },
  ])("parseInstallationToken accepts an expires_at with $case", ({ expiresAt, expected }) => {
    const parsed = parseInstallationToken({ token: FIXTURE_TOKEN, expires_at: expiresAt }, BEFORE);

    expect(parsed?.expiresAt, "expiresAt").toBe(expected);
  });

  it.each([
    { case: "null", body: null },
    { case: "an array", body: [] },
    { case: "a text", body: "token" },
    { case: "a number", body: 42 },
    { case: "an object without token", body: { expires_at: "2016-07-11T22:14:10Z" } },
    { case: "an object without expires_at", body: { token: FIXTURE_TOKEN } },
    { case: "an empty token", body: { token: "", expires_at: "2016-07-11T22:14:10Z" } },
    { case: "a token that is a number", body: { token: 42, expires_at: "2016-07-11T22:14:10Z" } },
    { case: "a token of 256 characters", body: { token: "a".repeat(256), expires_at: "2016-07-11T22:14:10Z" } },
    { case: "a token with a hyphen", body: { token: "ghs-abc", expires_at: "2016-07-11T22:14:10Z" } },
    { case: "a token with a line break", body: { token: "ghs_a\r\nX: y", expires_at: "2016-07-11T22:14:10Z" } },
    { case: "an expires_at that is a number", body: { token: FIXTURE_TOKEN, expires_at: 1_468_275_250 } },
    { case: "an expires_at that is a word", body: { token: FIXTURE_TOKEN, expires_at: "tomorrow" } },
    { case: "an expires_at that is only a date", body: { token: FIXTURE_TOKEN, expires_at: "2016-07-11" } },
    { case: "an expires_at without a time zone", body: { token: FIXTURE_TOKEN, expires_at: "2016-07-11T22:14:10" } },
    { case: "an expires_at with a space for T", body: { token: FIXTURE_TOKEN, expires_at: "2016-07-11 22:14:10Z" } },
    { case: "an expires_at with a lowercase z", body: { token: FIXTURE_TOKEN, expires_at: "2016-07-11T22:14:10z" } },
    { case: "an expires_at that is no real time", body: { token: FIXTURE_TOKEN, expires_at: "2016-13-45T25:61:61Z" } },
    {
      case: "an expires_at with a trailing line feed",
      body: { token: FIXTURE_TOKEN, expires_at: "2016-07-11T22:14:10Z\n" },
    },
    {
      case: "an expires_at that has already passed",
      body: { token: FIXTURE_TOKEN, expires_at: "2016-07-11T19:00:00Z" },
    },
    {
      case: "an expires_at exactly 5 minutes ahead",
      body: { token: FIXTURE_TOKEN, expires_at: "2016-07-11T20:05:00Z" },
    },
    {
      case: "an expires_at 5 minutes less one second ahead",
      body: { token: FIXTURE_TOKEN, expires_at: "2016-07-11T20:04:59Z" },
    },
  ])("parseInstallationToken rejects $case", ({ body }) => {
    const parsed = parseInstallationToken(body, BEFORE);

    expect(parsed, "narrowed answer").toBeUndefined();
  });

  it("parseInstallationToken accepts an expires_at 5 minutes and one second ahead", () => {
    const parsed = parseInstallationToken({ token: FIXTURE_TOKEN, expires_at: "2016-07-11T20:05:01Z" }, BEFORE);

    expect(parsed?.token, "token").toBe(FIXTURE_TOKEN);
  });

  it("parseInstallationToken counts the 5 minutes from the time it is given", () => {
    const body = { token: FIXTURE_TOKEN, expires_at: "2016-07-11T20:05:01Z" };

    const parsed = parseInstallationToken(body, new Date("2016-07-11T20:00:02Z"));

    expect(parsed, "narrowed answer").toBeUndefined();
  });
});

describe("installationToken", () => {
  it("installationToken reuses a cached token that expires more than 5 minutes after now", async () => {
    const key = await keyFor(SECRET);
    const expiresAt = NOW.getTime() + TOKEN_RENEWAL_MARGIN_MS + 1;
    const iv = await seedCachedToken(env.DB, key, INSTALLATION, "ghs_cached", expiresAt);
    const github = githubApiDouble({});

    const issued = await installationToken(await depsFor(github), await credentials(), INSTALLATION);

    expect(issued, "issued token").toEqual({ token: "ghs_cached", iv });
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it.each([
    { case: "exactly 5 minutes after now", expiresAt: NOW.getTime() + TOKEN_RENEWAL_MARGIN_MS },
    { case: "1 ms less than 5 minutes after now", expiresAt: NOW.getTime() + TOKEN_RENEWAL_MARGIN_MS - 1 },
    { case: "now", expiresAt: NOW.getTime() },
    { case: "an hour ago", expiresAt: NOW.getTime() - HOUR_MS },
  ])("installationToken renews a token that expires $case and replaces the row", async ({ expiresAt }) => {
    const key = await keyFor(SECRET);
    const oldIv = await seedCachedToken(env.DB, key, INSTALLATION, "ghs_old", expiresAt);
    const github = issuingDouble();

    const issued = await installationToken(await depsFor(github), await credentials(), INSTALLATION);

    expect(
      github.requests.map((request) => request.route),
      "routes requested",
    ).toEqual(["installationToken"]);
    const rows = await tokenRows(env.DB);
    expect(rows.length, "number of rows").toBe(1);
    expect(rows[0]?.iv, "iv of the replaced row").not.toBe(oldIv);
    expect(rows[0]?.expiresAt, "expires_at of the replaced row").toBe(FRESH_EXPIRY);
    expect(rows[0] === undefined ? undefined : await tokenOfRow(key, rows[0]), "token of the replaced row").toBe(
      NEW_TOKEN,
    );
    expect(issued, "issued token").toEqual({ token: NEW_TOKEN, iv: rows[0]?.iv });
  });

  it("installationToken requests, stores and returns a token when none is cached", async () => {
    const key = await keyFor(SECRET);
    const github = issuingDouble();

    const issued = await installationToken(await depsFor(github), await credentials(), INSTALLATION);

    const row = await tokenRowOf(env.DB, INSTALLATION);
    expect(issued, "issued token").toEqual({ token: NEW_TOKEN, iv: row?.iv });
    expect(row?.expiresAt, "expires_at is GitHub's time in milliseconds").toBe(FRESH_EXPIRY);
    expect(row === undefined ? undefined : await tokenOfRow(key, row), "token of the row").toBe(NEW_TOKEN);
  });

  it("installationToken reuses the token it stored on the next call", async () => {
    const github = issuingDouble();
    const deps = await depsFor(github);
    const first = await installationToken(deps, await credentials(), INSTALLATION);

    const second = await installationToken(deps, await credentials(), INSTALLATION);

    expect(second, "second result").toEqual(first);
    expect(github.requests.length, "number of GitHub requests").toBe(1);
  });

  it("installationToken posts to /app/installations/<id>/access_tokens with the app JWT", async () => {
    const github = issuingDouble();

    await installationToken(await depsFor(github), await credentials(), INSTALLATION);

    const [request, ...rest] = github.requests;
    expect(rest, "further requests").toEqual([]);
    expect(request?.method, "method").toBe("POST");
    expect(request?.url, "url").toBe("https://api.github.com/app/installations/1000003/access_tokens");
    expect(request?.hasBody, "has a body").toBe(false);
    const jwt = decodeJwt(bearerOf(request?.authorization ?? null) ?? "");
    expect(jwt, "the Bearer token is a JWT").toBeDefined();
    expect(jwt?.header, "JWT header").toEqual({ alg: "RS256", typ: "JWT" });
    const nowSeconds = NOW.getTime() / 1000;
    expect(jwt?.claims, "JWT claims").toEqual({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: APP_ID });
    expect(jwt === undefined ? false : await jwtVerifies(jwt), "JWT signature verifies").toBe(true);
  });

  it("installationToken sends the standard headers, no redirect following and a timeout signal", async () => {
    const github = issuingDouble();

    await installationToken(await depsFor(github), await credentials(), INSTALLATION);

    const [request] = github.requests;
    expect(request?.headers.get("accept"), "Accept").toBe("application/vnd.github+json");
    expect(request?.headers.get("x-github-api-version"), "X-GitHub-Api-Version").toBe("2022-11-28");
    expect(request?.headers.get("user-agent"), "User-Agent").toBe("seluna/1.2.3-test");
    expect(request?.redirect, "redirect").toBe("manual");
    expect(request?.signal.aborted, "signal aborted").toBe(false);
  });

  it("installationToken requests the token of the installation it is asked for", async () => {
    const github = issuingDouble();

    await installationToken(await depsFor(github), await credentials(), OTHER_INSTALLATION);

    expect(
      github.requests.map((request) => request.params),
      "path parameters",
    ).toEqual([["2000004"]]);
    expect(
      (await tokenRows(env.DB)).map((row) => row.installationId),
      "installations with a row",
    ).toEqual([OTHER_INSTALLATION]);
  });

  it.each([
    {
      case: "an altered ciphertext",
      prepare: () =>
        env.DB.prepare(
          "UPDATE token_cache SET ciphertext = (CASE WHEN substr(ciphertext, 1, 1) = 'A' THEN 'B' ELSE 'A' END) || substr(ciphertext, 2)",
        ).run(),
    },
    {
      case: "a changed expires_at",
      prepare: () => env.DB.prepare("UPDATE token_cache SET expires_at = expires_at + 1").run(),
    },
    { case: "a malformed IV", prepare: () => env.DB.prepare("UPDATE token_cache SET iv = '!!!!!!!!!!!!!!!!'").run() },
  ])("installationToken replaces a row that does not decrypt: $case", async ({ prepare }) => {
    const key = await keyFor(SECRET);
    await seedCachedToken(env.DB, key, INSTALLATION, "ghs_old", FRESH_EXPIRY);
    await prepare();
    const github = issuingDouble();

    const issued = await installationToken(await depsFor(github), await credentials(), INSTALLATION);

    const rows = await tokenRows(env.DB);
    expect(rows.length, "number of rows").toBe(1);
    expect(rows[0] === undefined ? undefined : await tokenOfRow(key, rows[0]), "token of the row").toBe(NEW_TOKEN);
    expect(issued?.token, "issued token").toBe(NEW_TOKEN);
  });

  it("installationToken replaces a row that was sealed under another SELUNA_SECRET", async () => {
    await seedCachedToken(env.DB, await keyFor(OTHER_SECRET), INSTALLATION, "ghs_old", FRESH_EXPIRY);
    const github = issuingDouble();
    const key = await keyFor(SECRET);

    const issued = await installationToken(await depsFor(github), await credentials(), INSTALLATION);

    const row = await tokenRowOf(env.DB, INSTALLATION);
    expect(row === undefined ? undefined : await tokenOfRow(key, row), "token of the row").toBe(NEW_TOKEN);
    expect(issued?.token, "issued token").toBe(NEW_TOKEN);
  });

  const FAILED_ANSWERS: readonly { readonly case: string; readonly answer: GitHubAnswer }[] = [
    { case: "is refused with 401", answer: jsonAnswer(401, { message: "Bad credentials" }) },
    { case: "is refused with 403", answer: jsonAnswer(403, { message: "suspended" }) },
    { case: "is refused with 404", answer: jsonAnswer(404, { message: "Not Found" }) },
    { case: "is refused with 422", answer: jsonAnswer(422, { message: "Validation Failed" }) },
    { case: "answers 500", answer: jsonAnswer(500, { message: "Server Error" }) },
    { case: "answers 503", answer: jsonAnswer(503, { message: "Unavailable" }) },
    {
      case: "is redirected",
      answer: { kind: "raw", status: 302, body: null, headers: { Location: "https://example.com/token" } },
    },
    { case: "is rejected by the network", answer: REJECTED },
    {
      case: "times out",
      answer: { kind: "reject", error: new DOMException("The operation timed out", "TimeoutError") },
    },
    { case: "answers text that is not JSON", answer: { kind: "raw", status: 201, body: "not json" } },
    {
      case: "answers more than 1 MiB",
      answer: { kind: "raw", status: 201, body: `"${"a".repeat(MAX_GITHUB_RESPONSE_BYTES)}"` },
    },
    { case: "answers without a token", answer: jsonAnswer(201, { expires_at: new Date(FRESH_EXPIRY).toISOString() }) },
    { case: "answers an empty token", answer: jsonAnswer(201, installationTokenBody("", FRESH_EXPIRY)) },
    { case: "answers a token with a hyphen", answer: jsonAnswer(201, installationTokenBody("ghs-abc", FRESH_EXPIRY)) },
    {
      case: "answers a token of 256 characters",
      answer: jsonAnswer(201, installationTokenBody("a".repeat(256), FRESH_EXPIRY)),
    },
    { case: "answers without expires_at", answer: jsonAnswer(201, { token: NEW_TOKEN }) },
    {
      case: "answers an expires_at that is no time",
      answer: jsonAnswer(201, { token: NEW_TOKEN, expires_at: "soon" }),
    },
    {
      case: "answers an expires_at exactly 5 minutes ahead",
      answer: jsonAnswer(201, installationTokenBody(NEW_TOKEN, NOW.getTime() + TOKEN_RENEWAL_MARGIN_MS)),
    },
    {
      case: "answers an expires_at that has passed",
      answer: jsonAnswer(201, installationTokenBody(NEW_TOKEN, NOW.getTime() - HOUR_MS)),
    },
  ];

  it.each(FAILED_ANSWERS)(
    "installationToken returns undefined and caches nothing when the request $case",
    async ({ answer }) => {
      const github = githubApiDouble({ installationToken: answer });

      const issued = await installationToken(await depsFor(github), await credentials(), INSTALLATION);

      expect(issued, "issued token").toBeUndefined();
      expect(await tokenRows(env.DB), "rows").toEqual([]);
      expect(github.requests.length, "number of GitHub requests").toBe(1);
    },
  );

  it("installationToken lets a D1 error on reading the cache reach the caller", async () => {
    const github = issuingDouble();

    const pending = installationToken(
      await depsFor(github, { db: migrationTestDb() }),
      await credentials(),
      INSTALLATION,
    );

    await expect(pending, "result").rejects.toThrow(/no such table/i);
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it("installationToken lets a D1 error on writing the cache reach the caller and returns no token", async () => {
    const github = issuingDouble();

    const pending = installationToken(
      await depsFor(github, { db: writeFailingDb(env.DB) }),
      await credentials(),
      INSTALLATION,
    );

    await expect(pending, "result").rejects.toThrow("The database may only be read");
    expect(await tokenRows(env.DB), "rows").toEqual([]);
  });
});
