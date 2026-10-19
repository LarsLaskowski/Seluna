import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { installationIdOf, isPullRequestDraft, isRepositoryName, parsePullRequestDraft } from "./api-client";
import type { GitHubApiDeps } from "./api-client";
import { MAX_GITHUB_RESPONSE_BYTES } from "./conversion";
import { applyMigrations, migrationTestDb, unusedDb, writeFailingDb } from "../../test/d1";
import {
  FIXTURE_PEM,
  FIXTURE_PKCS8,
  FIXTURE_PULL_REQUEST_DRAFT,
  githubApiDouble,
  installationTokenBody,
  jsonAnswer,
  pullRequestBody,
  REJECTED,
  RSA_4104_PKCS8,
} from "../../test/github";
import type { GitHubAnswer, GitHubDouble, RecordedGitHubRequest } from "../../test/github";
import { bearerOf, decodeJwt, jwtVerifies } from "../../test/jwt";
import { keyFor } from "../../test/keys";
import { seedCachedToken, tokenOfRow, tokenRowOf, tokenRows } from "../../test/token-cache";
import openedPayload from "../../test/fixtures/pull_request/opened.json";
import { writeSecrets } from "../store/secrets";

const SECRET = "throwaway-setup-secret-0123456789abcdef";
const VERSION = "1.2.3-test";
const NOW = new Date("2026-10-19T12:00:00Z");
const HOUR_MS = 3_600_000;
const FRESH_EXPIRY = NOW.getTime() + HOUR_MS;
const INSTALLATION = 1_000_003;
const OTHER_INSTALLATION = 2_000_004;
const WORKER_ENV = { SELUNA_SECRET: SECRET, GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: FIXTURE_PEM };
const PULL = { owner: "octocat", repo: "hello-world", number: 42 };
const FAILED = { kind: "failed" } as const;

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([env.DB.prepare("DELETE FROM token_cache"), env.DB.prepare("DELETE FROM secrets")]);
  await env.DB.prepare("DELETE FROM meta WHERE key = 'key_check'").run();
});

function depsFor(github: GitHubDouble, overrides: Partial<GitHubApiDeps> = {}): GitHubApiDeps {
  return { env: WORKER_ENV, db: env.DB, fetcher: github.fetch, now: () => NOW, version: VERSION, ...overrides };
}

/** The token a double issues for the installation of the token request. */
function tokenOf(installationId: number | string): string {
  return `ghs_token_${String(installationId)}`;
}

/** Answers a token request with the token of its installation, expiring one hour after `NOW`. */
function issueTokens(request: RecordedGitHubRequest): GitHubAnswer {
  return jsonAnswer(201, installationTokenBody(tokenOf(request.params[0] ?? ""), FRESH_EXPIRY));
}

/** A double that issues tokens and answers every pull request read with `answer`. */
function doubleWith(pullRequest: GitHubAnswer = jsonAnswer(200, pullRequestBody(false))): GitHubDouble {
  return githubApiDouble({ installationToken: issueTokens, pullRequest });
}

function routesOf(github: GitHubDouble): (string | undefined)[] {
  return github.requests.map((request) => request.route);
}

describe("installationIdOf", () => {
  it("installationIdOf reads installation.id of a real delivery", () => {
    const id = installationIdOf(openedPayload);

    expect(id, "installation id").toBe(1_000_003);
  });

  it.each([
    { case: "undefined", payload: undefined },
    { case: "null", payload: null },
    { case: "a text", payload: "payload" },
    { case: "an array", payload: [] },
    { case: "an object without installation", payload: { action: "opened" } },
    { case: "a null installation", payload: { installation: null } },
    { case: "an installation that is a number", payload: { installation: 5 } },
    { case: "an installation without id", payload: { installation: { node_id: "x" } } },
    { case: "an id that is a text", payload: { installation: { id: "42" } } },
    { case: "an id of 0", payload: { installation: { id: 0 } } },
    { case: "a negative id", payload: { installation: { id: -1 } } },
    { case: "a fractional id", payload: { installation: { id: 1.5 } } },
    { case: "an id beyond the safe integers", payload: { installation: { id: 2 ** 53 } } },
    { case: "an id of Infinity", payload: { installation: { id: Infinity } } },
    { case: "an id of NaN", payload: { installation: { id: NaN } } },
    { case: "an id that is null", payload: { installation: { id: null } } },
  ])("installationIdOf returns undefined for $case", ({ payload }) => {
    const id = installationIdOf(payload);

    expect(id, "installation id").toBeUndefined();
  });
});

describe("isRepositoryName", () => {
  it.each(["hello-world", "a", "a.b_c-d", "...", ".git", "-", "_", "a".repeat(100), "Hello-World.js"])(
    "isRepositoryName accepts %s",
    (name) => {
      const accepted = isRepositoryName(name);

      expect(accepted, "accepted").toBe(true);
    },
  );

  it.each([
    { case: "a dot", name: "." },
    { case: "two dots", name: ".." },
    { case: "an encoded dot", name: "%2e" },
    { case: "an encoded dot dot", name: ".%2e" },
    { case: "a slash", name: "a/b" },
    { case: "a backslash", name: "a\\b" },
    { case: "a question mark", name: "a?b" },
    { case: "a number sign", name: "a#b" },
    { case: "an empty text", name: "" },
    { case: "101 characters", name: "a".repeat(101) },
    { case: "a space", name: "a b" },
    { case: "a trailing line feed", name: "a\n" },
    { case: "a non-ASCII letter", name: "ä" },
  ])("isRepositoryName rejects $case", ({ name }) => {
    const accepted = isRepositoryName(name);

    expect(accepted, "accepted").toBe(false);
  });
});

describe("parsePullRequestDraft", () => {
  it("parsePullRequestDraft reads the draft flag of the captured pull request", () => {
    const draft = parsePullRequestDraft(pullRequestBody(FIXTURE_PULL_REQUEST_DRAFT));

    expect(draft, "draft").toBe(false);
  });

  it("parsePullRequestDraft reads true for a draft", () => {
    const draft = parsePullRequestDraft(pullRequestBody(true));

    expect(draft, "draft").toBe(true);
  });

  it.each([
    { case: "null", body: null },
    { case: "an array", body: [] },
    { case: "a text", body: "draft" },
    { case: "an object without draft", body: { number: 42 } },
    { case: "a draft that is the text true", body: { draft: "true" } },
    { case: "a draft that is 1", body: { draft: 1 } },
    { case: "a draft that is null", body: { draft: null } },
  ])("parsePullRequestDraft returns undefined for $case", ({ body }) => {
    const draft = parsePullRequestDraft(body);

    expect(draft, "draft").toBeUndefined();
  });
});

describe("isPullRequestDraft: tokens per installation", () => {
  it("isPullRequestDraft requests, stores and uses a token per installation id for two installations", async () => {
    const github = doubleWith();
    const deps = depsFor(github);
    const key = await keyFor(SECRET);

    const first = await isPullRequestDraft(deps, INSTALLATION, PULL);
    const second = await isPullRequestDraft(deps, OTHER_INSTALLATION, { owner: "octo-org", repo: "tools", number: 7 });

    expect([first, second], "results").toEqual([
      { kind: "ok", draft: false },
      { kind: "ok", draft: false },
    ]);
    expect(
      github.requests.filter((request) => request.route === "installationToken").map((request) => request.params),
      "token requests",
    ).toEqual([["1000003"], ["2000004"]]);
    const rows = await tokenRows(env.DB);
    expect(
      rows.map((row) => row.installationId),
      "installations with a row",
    ).toEqual([INSTALLATION, OTHER_INSTALLATION]);
    expect(await Promise.all(rows.map((row) => tokenOfRow(key, row))), "tokens of the rows").toEqual([
      tokenOf(INSTALLATION),
      tokenOf(OTHER_INSTALLATION),
    ]);
    const reads = github.requests.filter((request) => request.route === "pullRequest");
    expect(
      reads.map((request) => [request.url, request.authorization]),
      "repository requests",
    ).toEqual([
      ["https://api.github.com/repos/octocat/hello-world/pulls/42", `Bearer ${tokenOf(INSTALLATION)}`],
      ["https://api.github.com/repos/octo-org/tools/pulls/7", `Bearer ${tokenOf(OTHER_INSTALLATION)}`],
    ]);
  });

  it("isPullRequestDraft sends no token request when both installations have a cached token", async () => {
    const key = await keyFor(SECRET);
    await seedCachedToken(env.DB, key, INSTALLATION, "ghs_cached_a", FRESH_EXPIRY);
    await seedCachedToken(env.DB, key, OTHER_INSTALLATION, "ghs_cached_b", FRESH_EXPIRY);
    const github = doubleWith();
    const deps = depsFor(github);

    const first = await isPullRequestDraft(deps, INSTALLATION, PULL);
    const second = await isPullRequestDraft(deps, OTHER_INSTALLATION, PULL);

    expect([first, second], "results").toEqual([
      { kind: "ok", draft: false },
      { kind: "ok", draft: false },
    ]);
    expect(routesOf(github), "requests").toEqual(["pullRequest", "pullRequest"]);
    expect(
      github.requests.map((request) => request.authorization),
      "authorization of the reads",
    ).toEqual(["Bearer ghs_cached_a", "Bearer ghs_cached_b"]);
  });

  it("a token request for one installation leaves the other installation's row unchanged", async () => {
    const key = await keyFor(SECRET);
    await seedCachedToken(env.DB, key, INSTALLATION, "ghs_expiring", NOW.getTime() + 60_000);
    await seedCachedToken(env.DB, key, OTHER_INSTALLATION, "ghs_cached_b", FRESH_EXPIRY);
    const before = await tokenRowOf(env.DB, OTHER_INSTALLATION);
    const github = doubleWith();

    const result = await isPullRequestDraft(depsFor(github), INSTALLATION, PULL);

    expect(result, "result").toEqual({ kind: "ok", draft: false });
    expect(routesOf(github), "requests").toEqual(["installationToken", "pullRequest"]);
    expect(await tokenRowOf(env.DB, OTHER_INSTALLATION), "row of the other installation").toEqual(before);
    const own = await tokenRowOf(env.DB, INSTALLATION);
    expect(own === undefined ? undefined : await tokenOfRow(key, own), "token of the own row").toBe(
      tokenOf(INSTALLATION),
    );
  });

  it("isPullRequestDraft reuses the token it stored for the next call of the installation", async () => {
    const github = doubleWith();
    const deps = depsFor(github);

    await isPullRequestDraft(deps, INSTALLATION, PULL);
    const second = await isPullRequestDraft(deps, INSTALLATION, { ...PULL, number: 43 });

    expect(second, "second result").toEqual({ kind: "ok", draft: false });
    expect(routesOf(github), "requests").toEqual(["installationToken", "pullRequest", "pullRequest"]);
  });

  it("isPullRequestDraft works with the credentials saved by the wizard", async () => {
    const stored = await writeSecrets(env.DB, await keyFor(SECRET), {
      github_app_id: "54321",
      github_private_key: FIXTURE_PKCS8,
      github_webhook_secret: "webhook-secret-text",
    });
    expect(stored, "saving the app").toEqual({ kind: "ok" });
    const github = doubleWith();

    const result = await isPullRequestDraft(depsFor(github, { env: { SELUNA_SECRET: SECRET } }), INSTALLATION, PULL);

    expect(result, "result").toEqual({ kind: "ok", draft: false });
    const jwt = decodeJwt(bearerOf(github.requests[0]?.authorization ?? null) ?? "");
    expect(jwt?.claims, "JWT claims").toMatchObject({ iss: 54_321 });
  });
});

describe("isPullRequestDraft: requests", () => {
  it("isPullRequestDraft sends the app JWT to /app/... and the installation token to /repos/...", async () => {
    const github = doubleWith();

    await isPullRequestDraft(depsFor(github), INSTALLATION, PULL);

    const [tokenRequest, readRequest, ...rest] = github.requests;
    expect(rest, "further requests").toEqual([]);
    expect([tokenRequest?.method, tokenRequest?.url], "token request").toEqual([
      "POST",
      "https://api.github.com/app/installations/1000003/access_tokens",
    ]);
    const jwt = decodeJwt(bearerOf(tokenRequest?.authorization ?? null) ?? "");
    expect(jwt, "the token request carries a JWT").toBeDefined();
    expect(jwt?.claims, "JWT claims").toEqual({
      iat: NOW.getTime() / 1000 - 60,
      exp: NOW.getTime() / 1000 + 540,
      iss: 12_345,
    });
    expect(jwt === undefined ? false : await jwtVerifies(jwt), "JWT signature verifies").toBe(true);
    expect([readRequest?.method, readRequest?.url], "repository request").toEqual([
      "GET",
      "https://api.github.com/repos/octocat/hello-world/pulls/42",
    ]);
    expect(readRequest?.authorization, "repository request authorization").toBe(`Bearer ${tokenOf(INSTALLATION)}`);
  });

  it("isPullRequestDraft sends the standard headers on both requests, no redirect following and a timeout signal", async () => {
    const github = doubleWith();

    await isPullRequestDraft(depsFor(github), INSTALLATION, PULL);

    expect(github.requests.length, "number of requests").toBe(2);
    for (const request of github.requests) {
      expect(request.headers.get("accept"), `Accept of ${request.url}`).toBe("application/vnd.github+json");
      expect(request.headers.get("x-github-api-version"), `X-GitHub-Api-Version of ${request.url}`).toBe("2022-11-28");
      expect(request.headers.get("user-agent"), `User-Agent of ${request.url}`).toBe("seluna/1.2.3-test");
      expect(request.redirect, `redirect of ${request.url}`).toBe("manual");
      expect(request.signal.aborted, `signal of ${request.url} aborted`).toBe(false);
    }
  });

  it("isPullRequestDraft stores the token under the expiry GitHub gave, in milliseconds", async () => {
    const github = doubleWith();

    await isPullRequestDraft(depsFor(github), INSTALLATION, PULL);

    expect((await tokenRowOf(env.DB, INSTALLATION))?.expiresAt, "expires_at").toBe(FRESH_EXPIRY);
  });

  it.each([
    { case: "dots, underscores and hyphens", owner: "Octo-Org", repo: "a.b_c-d" },
    { case: "a repository named with three dots", owner: "octocat", repo: "..." },
    { case: "a one-character owner", owner: "a", repo: "r" },
    { case: "the longest owner and repository", owner: `a${"b".repeat(37)}c`, repo: "r".repeat(100) },
  ])("isPullRequestDraft reads the pull request path of $case", async ({ owner, repo }) => {
    const github = doubleWith();

    const result = await isPullRequestDraft(depsFor(github), INSTALLATION, { owner, repo, number: 9 });

    expect(result, "result").toEqual({ kind: "ok", draft: false });
    expect(github.requests[1]?.url, "url").toBe(`https://api.github.com/repos/${owner}/${repo}/pulls/9`);
  });
});

describe("isPullRequestDraft: the pull request answer", () => {
  it("isPullRequestDraft answers false for the captured pull request and true for its draft variant", async () => {
    const notDraft = await isPullRequestDraft(
      depsFor(doubleWith(jsonAnswer(200, pullRequestBody(false)))),
      INSTALLATION,
      PULL,
    );
    const draft = await isPullRequestDraft(
      depsFor(doubleWith(jsonAnswer(200, pullRequestBody(true)))),
      INSTALLATION,
      PULL,
    );

    expect(notDraft, "captured pull request").toEqual({ kind: "ok", draft: false });
    expect(draft, "draft variant").toEqual({ kind: "ok", draft: true });
  });
});

describe("isPullRequestDraft: guards", () => {
  it.each([
    { case: "an installation id of 0", id: 0 },
    { case: "a negative installation id", id: -1 },
    { case: "a fractional installation id", id: 1.5 },
    { case: "an installation id beyond the safe integers", id: 2 ** 53 },
    { case: "an installation id of NaN", id: NaN },
    { case: "an installation id of Infinity", id: Infinity },
  ])("isPullRequestDraft fails without a request: $case", async ({ id }) => {
    const github = doubleWith();

    const result = await isPullRequestDraft(depsFor(github), id, PULL);

    expect(result, "result").toEqual(FAILED);
    expect(github.requests, "GitHub requests").toEqual([]);
    expect(await tokenRows(env.DB), "rows").toEqual([]);
  });

  it("isPullRequestDraft fails without a request: an installation id that is a text", async () => {
    const github = doubleWith();

    // @ts-expect-error -- a delivery's id is unchecked JSON; the guard must refuse a text although the type says number
    const result = await isPullRequestDraft(depsFor(github), "42", PULL);

    expect(result, "result").toEqual(FAILED);
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it.each([
    { case: "an empty owner", owner: "" },
    { case: "an owner with a leading hyphen", owner: "-a" },
    { case: "an owner with a trailing hyphen", owner: "a-" },
    { case: "an owner of 40 characters", owner: "a".repeat(40) },
    { case: "an owner with a slash", owner: "a/b" },
    { case: "an owner with a backslash", owner: "a\\b" },
    { case: "an owner with an encoded slash", owner: "a%2fb" },
    { case: "an owner with a question mark", owner: "a?b" },
    { case: "an owner with a number sign", owner: "a#b" },
    { case: "an owner of a dot", owner: "." },
    { case: "an owner of two dots", owner: ".." },
    { case: "an owner with a non-ASCII letter", owner: "ö" },
  ])("isPullRequestDraft fails without a request: $case", async ({ owner }) => {
    const github = doubleWith();

    const result = await isPullRequestDraft(depsFor(github), INSTALLATION, { ...PULL, owner });

    expect(result, "result").toEqual(FAILED);
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it.each([
    { case: "a repository of a dot", repo: "." },
    { case: "a repository of two dots", repo: ".." },
    { case: "a repository of an encoded dot", repo: "%2e" },
    { case: "a repository with a slash", repo: "a/b" },
    { case: "a repository with a backslash", repo: "a\\b" },
    { case: "a repository with a question mark", repo: "a?b" },
    { case: "a repository with a number sign", repo: "a#b" },
    { case: "an empty repository", repo: "" },
    { case: "a repository of 101 characters", repo: "a".repeat(101) },
    { case: "a repository with a space", repo: "a b" },
  ])("isPullRequestDraft fails without a request: $case", async ({ repo }) => {
    const github = doubleWith();

    const result = await isPullRequestDraft(depsFor(github), INSTALLATION, { ...PULL, repo });

    expect(result, "result").toEqual(FAILED);
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it.each([
    { case: "a pull request number of 0", number: 0 },
    { case: "a negative pull request number", number: -1 },
    { case: "a fractional pull request number", number: 1.5 },
    { case: "a pull request number beyond the safe integers", number: 2 ** 53 },
    { case: "a pull request number of NaN", number: NaN },
    { case: "a pull request number of Infinity", number: Infinity },
  ])("isPullRequestDraft fails without a request: $case", async ({ number }) => {
    const github = doubleWith();

    const result = await isPullRequestDraft(depsFor(github), INSTALLATION, { ...PULL, number });

    expect(result, "result").toEqual(FAILED);
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it.each<{ case: string; overrides: Partial<GitHubApiDeps> }>([
    { case: "no app anywhere", overrides: { env: { SELUNA_SECRET: SECRET } } },
    {
      case: "an App ID that is not a positive whole number",
      overrides: { env: { ...WORKER_ENV, GITHUB_APP_ID: "0" } },
    },
    { case: "a key that is no PEM", overrides: { env: { ...WORKER_ENV, GITHUB_APP_PRIVATE_KEY: "not a pem" } } },
    {
      case: "a key of more than 4096 bits",
      overrides: { env: { ...WORKER_ENV, GITHUB_APP_PRIVATE_KEY: RSA_4104_PKCS8 } },
    },
    {
      case: "Worker secrets and no SELUNA_SECRET to encrypt a token with",
      overrides: { env: { GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: FIXTURE_PEM } },
    },
    {
      case: "Worker secrets and a SELUNA_SECRET of 31 characters",
      overrides: { env: { ...WORKER_ENV, SELUNA_SECRET: "a".repeat(31) } },
    },
  ])("isPullRequestDraft fails without a request: $case", async ({ overrides }) => {
    const github = doubleWith();

    const result = await isPullRequestDraft(depsFor(github, overrides), INSTALLATION, PULL);

    expect(result, "result").toEqual(FAILED);
    expect(github.requests, "GitHub requests").toEqual([]);
    expect(await tokenRows(env.DB), "rows").toEqual([]);
  });
});

describe("isPullRequestDraft: failures", () => {
  const REFUSED_OR_BROKEN: readonly { readonly case: string; readonly answer: GitHubAnswer }[] = [
    { case: "is refused with 401", answer: jsonAnswer(401, { message: "Bad credentials" }) },
    { case: "is refused with 403", answer: jsonAnswer(403, { message: "suspended" }) },
    { case: "is refused with 404", answer: jsonAnswer(404, { message: "Not Found" }) },
    { case: "is refused with 422", answer: jsonAnswer(422, { message: "Validation Failed" }) },
    { case: "answers 500", answer: jsonAnswer(500, { message: "Server Error" }) },
    { case: "answers 502", answer: jsonAnswer(502, { message: "Bad Gateway" }) },
    {
      case: "is redirected",
      answer: { kind: "raw", status: 301, body: null, headers: { Location: "https://example.com/" } },
    },
    { case: "is rejected by the network", answer: REJECTED },
    { case: "times out", answer: { kind: "reject", error: new DOMException("timed out", "TimeoutError") } },
  ];

  const UNREADABLE_TOKEN_ANSWERS: readonly { readonly case: string; readonly answer: GitHubAnswer }[] = [
    { case: "answers text that is not JSON", answer: { kind: "raw", status: 201, body: "not json" } },
    {
      case: "answers more than 1 MiB",
      answer: { kind: "raw", status: 201, body: `"${"a".repeat(MAX_GITHUB_RESPONSE_BYTES)}"` },
    },
    { case: "answers without a token", answer: jsonAnswer(201, { expires_at: new Date(FRESH_EXPIRY).toISOString() }) },
    { case: "answers a token with a hyphen", answer: jsonAnswer(201, installationTokenBody("ghs-abc", FRESH_EXPIRY)) },
    {
      case: "answers a token of 256 characters",
      answer: jsonAnswer(201, installationTokenBody("a".repeat(256), FRESH_EXPIRY)),
    },
    {
      case: "answers an expires_at that is no time",
      answer: jsonAnswer(201, { token: "ghs_abc", expires_at: "soon" }),
    },
    {
      case: "answers an expires_at exactly 5 minutes ahead",
      answer: jsonAnswer(201, installationTokenBody("ghs_abc", NOW.getTime() + 300_000)),
    },
  ];

  it.each([...REFUSED_OR_BROKEN, ...UNREADABLE_TOKEN_ANSWERS])(
    "isPullRequestDraft fails and caches nothing when the token request $case",
    async ({ answer }) => {
      const github = githubApiDouble({
        installationToken: answer,
        pullRequest: jsonAnswer(200, pullRequestBody(false)),
      });

      const result = await isPullRequestDraft(depsFor(github), INSTALLATION, PULL);

      expect(result, "result").toEqual(FAILED);
      expect(routesOf(github), "requests").toEqual(["installationToken"]);
      expect(await tokenRows(env.DB), "rows").toEqual([]);
    },
  );

  it.each([
    ...REFUSED_OR_BROKEN.filter((entry) => !entry.case.endsWith("401")),
    { case: "answers text that is not JSON", answer: { kind: "raw", status: 200, body: "not json" } },
    {
      case: "answers more than 1 MiB",
      answer: { kind: "raw", status: 200, body: `"${"a".repeat(MAX_GITHUB_RESPONSE_BYTES)}"` },
    },
    { case: "answers without draft", answer: jsonAnswer(200, { number: 42 }) },
    { case: "answers a draft that is a text", answer: jsonAnswer(200, { draft: "false" }) },
    { case: "answers a list", answer: jsonAnswer(200, [pullRequestBody(false)]) },
  ] satisfies readonly { readonly case: string; readonly answer: GitHubAnswer }[])(
    "isPullRequestDraft fails when the repository request $case",
    async ({ answer }) => {
      const github = doubleWith(answer);

      const result = await isPullRequestDraft(depsFor(github), INSTALLATION, PULL);

      expect(result, "result").toEqual(FAILED);
      expect(routesOf(github), "requests").toEqual(["installationToken", "pullRequest"]);
      expect(JSON.stringify(result), "the result carries no token").not.toContain(tokenOf(INSTALLATION));
    },
  );

  it("isPullRequestDraft fails without the repository request when writing the cache fails", async () => {
    const github = doubleWith();

    const result = await isPullRequestDraft(depsFor(github, { db: writeFailingDb(env.DB) }), INSTALLATION, PULL);

    expect(result, "result").toEqual(FAILED);
    expect(routesOf(github), "requests").toEqual(["installationToken"]);
    expect(await tokenRows(env.DB), "rows").toEqual([]);
  });

  it("isPullRequestDraft fails without a request to GitHub when reading the cache fails", async () => {
    const github = doubleWith();

    const result = await isPullRequestDraft(depsFor(github, { db: migrationTestDb() }), INSTALLATION, PULL);

    expect(result, "result").toEqual(FAILED);
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it("isPullRequestDraft fails instead of throwing when the database throws", async () => {
    const github = doubleWith();

    const result = await isPullRequestDraft(depsFor(github, { db: unusedDb() }), INSTALLATION, PULL);

    expect(result, "result").toEqual(FAILED);
  });

  it("isPullRequestDraft fails instead of throwing when fetch throws before returning a promise", async () => {
    const github = doubleWith();
    const deps = depsFor(github, {
      fetcher: () => {
        throw new Error("synchronous failure");
      },
    });

    const result = await isPullRequestDraft(deps, INSTALLATION, PULL);

    expect(result, "result").toEqual(FAILED);
  });

  it("isPullRequestDraft fails when the clock throws", async () => {
    const github = doubleWith();
    const deps = depsFor(github, {
      now: () => {
        throw new Error("clock failure");
      },
    });

    const result = await isPullRequestDraft(deps, INSTALLATION, PULL);

    expect(result, "result").toEqual(FAILED);
  });
});

describe("isPullRequestDraft: a 401 on the repository request", () => {
  it("a 401 deletes the cached row the request used", async () => {
    await seedCachedToken(env.DB, await keyFor(SECRET), INSTALLATION, "ghs_revoked", FRESH_EXPIRY);
    const github = doubleWith(jsonAnswer(401, { message: "Bad credentials" }));

    const result = await isPullRequestDraft(depsFor(github), INSTALLATION, PULL);

    expect(result, "result").toEqual(FAILED);
    expect(routesOf(github), "requests").toEqual(["pullRequest"]);
    expect(github.requests[0]?.authorization, "token the request used").toBe("Bearer ghs_revoked");
    expect(await tokenRows(env.DB), "rows").toEqual([]);
  });

  it("a 401 deletes the row stored in the same call", async () => {
    const github = doubleWith(jsonAnswer(401, { message: "Bad credentials" }));

    const result = await isPullRequestDraft(depsFor(github), INSTALLATION, PULL);

    expect(result, "result").toEqual(FAILED);
    expect(routesOf(github), "requests").toEqual(["installationToken", "pullRequest"]);
    expect(await tokenRows(env.DB), "rows").toEqual([]);
  });

  it("a 401 leaves a row another call replaced in between", async () => {
    const key = await keyFor(SECRET);
    await seedCachedToken(env.DB, key, INSTALLATION, "ghs_revoked", FRESH_EXPIRY);
    const replaceThenRefuse = async (): Promise<GitHubAnswer> => {
      await seedCachedToken(env.DB, key, INSTALLATION, "ghs_replaced_by_another_call", FRESH_EXPIRY + 1000);
      return jsonAnswer(401, { message: "Bad credentials" });
    };
    const github = githubApiDouble({ installationToken: issueTokens, pullRequest: replaceThenRefuse });

    const result = await isPullRequestDraft(depsFor(github), INSTALLATION, PULL);

    expect(result, "result").toEqual(FAILED);
    const row = await tokenRowOf(env.DB, INSTALLATION);
    expect(row === undefined ? undefined : await tokenOfRow(key, row), "token of the remaining row").toBe(
      "ghs_replaced_by_another_call",
    );
  });

  it("a 401 leaves a row another call replaced after this call stored its own token", async () => {
    const key = await keyFor(SECRET);
    const replaceThenRefuse = async (): Promise<GitHubAnswer> => {
      await seedCachedToken(env.DB, key, INSTALLATION, "ghs_replaced_by_another_call", FRESH_EXPIRY + 1000);
      return jsonAnswer(401, { message: "Bad credentials" });
    };
    const github = githubApiDouble({ installationToken: issueTokens, pullRequest: replaceThenRefuse });

    await isPullRequestDraft(depsFor(github), INSTALLATION, PULL);

    const row = await tokenRowOf(env.DB, INSTALLATION);
    expect(row === undefined ? undefined : await tokenOfRow(key, row), "token of the remaining row").toBe(
      "ghs_replaced_by_another_call",
    );
  });

  it("a 401 leaves the row of another installation", async () => {
    const key = await keyFor(SECRET);
    await seedCachedToken(env.DB, key, INSTALLATION, "ghs_revoked", FRESH_EXPIRY);
    await seedCachedToken(env.DB, key, OTHER_INSTALLATION, "ghs_other", FRESH_EXPIRY);
    const github = doubleWith(jsonAnswer(401, { message: "Bad credentials" }));

    await isPullRequestDraft(depsFor(github), INSTALLATION, PULL);

    expect(
      (await tokenRows(env.DB)).map((row) => row.installationId),
      "installations with a row",
    ).toEqual([OTHER_INSTALLATION]);
  });

  it("the call after a 401 requests a new token and succeeds", async () => {
    await seedCachedToken(env.DB, await keyFor(SECRET), INSTALLATION, "ghs_revoked", FRESH_EXPIRY);
    const github = githubApiDouble({
      installationToken: issueTokens,
      pullRequest: [jsonAnswer(401, { message: "Bad credentials" }), jsonAnswer(200, pullRequestBody(true))],
    });
    const deps = depsFor(github);

    const first = await isPullRequestDraft(deps, INSTALLATION, PULL);
    const second = await isPullRequestDraft(deps, INSTALLATION, PULL);

    expect([first, second], "results").toEqual([FAILED, { kind: "ok", draft: true }]);
    expect(routesOf(github), "requests").toEqual(["pullRequest", "installationToken", "pullRequest"]);
    expect(github.requests[2]?.authorization, "token of the second read").toBe(`Bearer ${tokenOf(INSTALLATION)}`);
  });

  it("a 401 fails without throwing when deleting the row fails, and the row stays", async () => {
    await seedCachedToken(env.DB, await keyFor(SECRET), INSTALLATION, "ghs_revoked", FRESH_EXPIRY);
    const github = doubleWith(jsonAnswer(401, { message: "Bad credentials" }));

    const result = await isPullRequestDraft(depsFor(github, { db: writeFailingDb(env.DB) }), INSTALLATION, PULL);

    expect(result, "result").toEqual(FAILED);
    expect((await tokenRows(env.DB)).length, "number of rows").toBe(1);
  });

  it.each([
    { case: "the cached row", cached: true },
    { case: "the row stored in the same call", cached: false },
  ])("a 404 leaves $case", async ({ cached }) => {
    const key = await keyFor(SECRET);
    const iv = cached ? await seedCachedToken(env.DB, key, INSTALLATION, "ghs_cached", FRESH_EXPIRY) : undefined;
    const github = doubleWith(jsonAnswer(404, { message: "Not Found" }));

    const result = await isPullRequestDraft(depsFor(github), INSTALLATION, PULL);

    expect(result, "result").toEqual(FAILED);
    const row = await tokenRowOf(env.DB, INSTALLATION);
    expect(row, "row").toBeDefined();
    expect(iv === undefined || row?.iv === iv, "the cached row is the same one").toBe(true);
    expect(row === undefined ? undefined : await tokenOfRow(key, row), "token of the row").toBe(
      cached ? "ghs_cached" : tokenOf(INSTALLATION),
    );
  });

  it.each([403, 422, 500])("a %i leaves the row", async (status) => {
    await seedCachedToken(env.DB, await keyFor(SECRET), INSTALLATION, "ghs_cached", FRESH_EXPIRY);
    const github = doubleWith(jsonAnswer(status, { message: "refused" }));

    await isPullRequestDraft(depsFor(github), INSTALLATION, PULL);

    expect((await tokenRows(env.DB)).length, "number of rows").toBe(1);
  });
});

describe("isPullRequestDraft: concurrent calls", () => {
  it("two concurrent calls for one installation without a cached token both succeed and leave one row", async () => {
    const key = await keyFor(SECRET);
    let issued = 0;
    const github = githubApiDouble({
      installationToken: () => {
        issued += 1;
        return jsonAnswer(201, installationTokenBody(`ghs_concurrent_${String(issued)}`, FRESH_EXPIRY));
      },
      pullRequest: (request) =>
        request.authorization?.startsWith("Bearer ghs_concurrent_") === true
          ? jsonAnswer(200, pullRequestBody(false))
          : jsonAnswer(401, { message: "Bad credentials" }),
    });
    const deps = depsFor(github);

    const results = await Promise.all([
      isPullRequestDraft(deps, INSTALLATION, PULL),
      isPullRequestDraft(deps, INSTALLATION, { ...PULL, number: 43 }),
    ]);

    expect(results, "results").toEqual([
      { kind: "ok", draft: false },
      { kind: "ok", draft: false },
    ]);
    const rows = await tokenRows(env.DB);
    expect(rows.length, "number of rows").toBe(1);
    const token = rows[0] === undefined ? undefined : await tokenOfRow(key, rows[0]);
    expect(token, "token of the row is one of the issued ones").toMatch(/^ghs_concurrent_[12]$/);
  });
});
