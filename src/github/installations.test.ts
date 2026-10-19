import { describe, expect, it } from "vitest";
import { MAX_GITHUB_RESPONSE_BYTES } from "./conversion";
import { hasNextPage, listInstallations, MAX_INSTALLATIONS, parseInstallations } from "./installations";
import type { Installation } from "./installations";
import { githubApiDouble, installationEntry, jsonAnswer, REJECTED } from "../../test/github";
import type { GitHubAnswer } from "../../test/github";
import { bearerOf, decodeJwt, fixtureSigningKey, jwtVerifies } from "../../test/jwt";

const VERSION = "1.2.3-test";
const APP_ID = 12_345;
const NOW = new Date("2026-10-19T12:00:00Z");
const NEXT_LINK =
  '<https://api.github.com/app/installations?per_page=100&page=2>; rel="next", <https://api.github.com/app/installations?per_page=100&page=5>; rel="last"';

const OCTOCAT: Installation = {
  id: 1,
  account: { kind: "login", login: "octocat", type: "User" },
  repositorySelection: "selected",
  suspended: false,
};

/** `count` installations with the ids 1 to `count`. */
function entries(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => installationEntry({ id: index + 1 }));
}

async function credentials(): Promise<{ readonly appId: number; readonly signingKey: CryptoKey }> {
  return { appId: APP_ID, signingKey: await fixtureSigningKey() };
}

describe("parseInstallations", () => {
  it("parseInstallations narrows the documented answer", () => {
    const parsed = parseInstallations([installationEntry()]);

    expect(parsed, "installations").toEqual([OCTOCAT]);
  });

  it("parseInstallations narrows an empty list to an empty list", () => {
    const parsed = parseInstallations([]);

    expect(parsed, "installations").toEqual([]);
  });

  it("parseInstallations keeps GitHub's order", () => {
    const parsed = parseInstallations([
      installationEntry({ id: 30 }),
      installationEntry({ id: 10 }),
      installationEntry({ id: 20 }),
    ]);

    expect(
      parsed?.map((installation) => installation.id),
      "ids",
    ).toEqual([30, 10, 20]);
  });

  it.each<{ case: string; changes: Record<string, unknown>; expected: Partial<Installation> }>([
    {
      case: "an organization account",
      changes: { account: { login: "octo-org", type: "Organization" } },
      expected: { account: { kind: "login", login: "octo-org", type: "Organization" } },
    },
    {
      case: "an account with another type",
      changes: { account: { login: "robot", type: "Bot" } },
      expected: { account: { kind: "login", login: "robot", type: "Bot" } },
    },
    {
      case: "an account with a login and no type",
      changes: { account: { login: "octocat" } },
      expected: { account: { kind: "login", login: "octocat", type: undefined } },
    },
    {
      case: "an enterprise account with a slug and a name",
      changes: { account: { slug: "acme", name: "Acme Inc", id: 7 } },
      expected: { account: { kind: "enterprise", slug: "acme" } },
    },
    { case: "a null account", changes: { account: null }, expected: { account: { kind: "unknown" } } },
    {
      case: "an account without login and slug",
      changes: { account: { id: 5 } },
      expected: { account: { kind: "unknown" } },
    },
    {
      case: "an account whose login is not a text",
      changes: { account: { login: 5 } },
      expected: { account: { kind: "unknown" } },
    },
    { case: "all repositories", changes: { repository_selection: "all" }, expected: { repositorySelection: "all" } },
    {
      case: "a suspended installation",
      changes: { suspended_at: "2026-01-02T03:04:05Z" },
      expected: { suspended: true },
    },
    { case: "a null suspended_at", changes: { suspended_at: null }, expected: { suspended: false } },
    { case: "a missing suspended_at", changes: { suspended_at: undefined }, expected: { suspended: false } },
  ])("parseInstallations narrows $case", ({ changes, expected }) => {
    const parsed = parseInstallations([installationEntry(changes)]);

    expect(parsed, "installations").toEqual([{ ...OCTOCAT, ...expected }]);
  });

  it.each<{ case: string; body: unknown }>([
    { case: "an object instead of a list", body: { total_count: 1, installations: [installationEntry()] } },
    { case: "null", body: null },
    { case: "a text", body: "installations" },
    { case: "an entry that is null", body: [null] },
    { case: "an entry that is a number", body: [5] },
    { case: "an entry that is a text", body: ["x"] },
    { case: "an entry without an id", body: [installationEntry({ id: undefined })] },
    { case: "an id of 0", body: [installationEntry({ id: 0 })] },
    { case: "a negative id", body: [installationEntry({ id: -1 })] },
    { case: "a fractional id", body: [installationEntry({ id: 1.5 })] },
    { case: "an id that is a text", body: [installationEntry({ id: "1" })] },
    { case: "an id beyond the safe integers", body: [installationEntry({ id: 2 ** 53 })] },
    { case: "an account that is a text", body: [installationEntry({ account: "octocat" })] },
    { case: "an account that is a number", body: [installationEntry({ account: 5 })] },
    { case: "a missing account", body: [installationEntry({ account: undefined })] },
    { case: "a repository_selection of none", body: [installationEntry({ repository_selection: "none" })] },
    { case: "a missing repository_selection", body: [installationEntry({ repository_selection: undefined })] },
    { case: "a repository_selection that is a number", body: [installationEntry({ repository_selection: 1 })] },
    {
      case: "one bad entry among good ones",
      body: [installationEntry({ id: 1 }), installationEntry({ id: 0 }), installationEntry({ id: 3 })],
    },
  ])("parseInstallations rejects the whole list for $case", ({ body }) => {
    const parsed = parseInstallations(body);

    expect(parsed, "installations").toBeUndefined();
  });
});

describe("hasNextPage", () => {
  it.each([
    { case: "the documented header", link: NEXT_LINK, expected: true },
    {
      case: "a next link after a last link",
      link: '<https://api.github.com/app/installations?page=5>; rel="last", <https://api.github.com/app/installations?page=2>; rel="next"',
      expected: true,
    },
    {
      case: "a next link alone",
      link: '<https://api.github.com/app/installations?page=2>; rel="next"',
      expected: true,
    },
    { case: "rel=last only", link: '<https://api.github.com/app/installations?page=5>; rel="last"', expected: false },
    {
      case: "prev and first links",
      link: '<https://api.github.com/x?page=1>; rel="prev", <https://api.github.com/x?page=1>; rel="first"',
      expected: false,
    },
    { case: "an absent header", link: null, expected: false },
    { case: "an empty header", link: "", expected: false },
    { case: "rel=next unquoted", link: "<https://api.github.com/app/installations?page=2>; rel=next", expected: false },
    {
      case: "a rel value that only starts with next",
      link: '<https://api.github.com/app/installations?page=2>; rel="nextish"',
      expected: false,
    },
    {
      case: "the text rel=next inside the URL of a last link",
      link: '<https://api.github.com/app/installations?x=rel="next">; rel="last"',
      expected: false,
    },
  ])("hasNextPage is $expected for $case", ({ link, expected }) => {
    const more = hasNextPage(link);

    expect(more, "has a next page").toBe(expected);
  });
});

describe("listInstallations", () => {
  it("listInstallations sends GET /app/installations?per_page=100 with the app JWT", async () => {
    const github = githubApiDouble({ installations: jsonAnswer(200, [installationEntry()]) });

    await listInstallations(github.fetch, VERSION, NOW, await credentials());

    const [request, ...rest] = github.requests;
    expect(rest, "further requests").toEqual([]);
    expect(request?.method, "method").toBe("GET");
    expect(request?.url, "url").toBe("https://api.github.com/app/installations?per_page=100");
    const jwt = decodeJwt(bearerOf(request?.authorization ?? null) ?? "");
    expect(jwt, "the Bearer token is a JWT").toBeDefined();
    const nowSeconds = NOW.getTime() / 1000;
    expect(jwt?.claims, "JWT claims").toEqual({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: APP_ID });
    expect(jwt === undefined ? false : await jwtVerifies(jwt), "JWT signature verifies").toBe(true);
  });

  it("listInstallations sends the standard headers, no redirect following and a timeout signal", async () => {
    const github = githubApiDouble({ installations: jsonAnswer(200, []) });

    await listInstallations(github.fetch, VERSION, NOW, await credentials());

    const [request] = github.requests;
    expect(request?.headers.get("accept"), "Accept").toBe("application/vnd.github+json");
    expect(request?.headers.get("x-github-api-version"), "X-GitHub-Api-Version").toBe("2022-11-28");
    expect(request?.headers.get("user-agent"), "User-Agent").toBe("seluna/1.2.3-test");
    expect(request?.redirect, "redirect").toBe("manual");
    expect(request?.signal.aborted, "signal aborted").toBe(false);
  });

  it("listInstallations lists the documented answer without more", async () => {
    const github = githubApiDouble({ installations: jsonAnswer(200, [installationEntry()]) });

    const result = await listInstallations(github.fetch, VERSION, NOW, await credentials());

    expect(result, "result").toEqual({ kind: "listed", installations: [OCTOCAT], more: false });
  });

  it("listInstallations lists an empty answer", async () => {
    const github = githubApiDouble({ installations: jsonAnswer(200, []) });

    const result = await listInstallations(github.fetch, VERSION, NOW, await credentials());

    expect(result, "result").toEqual({ kind: "listed", installations: [], more: false });
  });

  it("listInstallations reports more when the Link header names a next page, and asks for one page only", async () => {
    const github = githubApiDouble({ installations: jsonAnswer(200, entries(100), { Link: NEXT_LINK }) });

    const result = await listInstallations(github.fetch, VERSION, NOW, await credentials());

    expect(result.kind, "result kind").toBe("listed");
    expect(result.kind === "listed" ? result.more : undefined, "more").toBe(true);
    expect(github.requests.length, "number of GitHub requests").toBe(1);
  });

  it("listInstallations reports no more for 100 entries without a next link", async () => {
    const github = githubApiDouble({
      installations: jsonAnswer(200, entries(100), {
        Link: '<https://api.github.com/app/installations?page=1>; rel="last"',
      }),
    });

    const result = await listInstallations(github.fetch, VERSION, NOW, await credentials());

    expect(result.kind === "listed" ? result.installations.length : undefined, "number of installations").toBe(100);
    expect(result.kind === "listed" ? result.more : undefined, "more").toBe(false);
  });

  it("listInstallations keeps at most 100 entries, the first ones in GitHub's order", async () => {
    const github = githubApiDouble({ installations: jsonAnswer(200, entries(MAX_INSTALLATIONS + 1)) });

    const result = await listInstallations(github.fetch, VERSION, NOW, await credentials());

    const ids = result.kind === "listed" ? result.installations.map((installation) => installation.id) : [];
    expect(ids.length, "number of installations").toBe(100);
    expect(ids[0], "first id").toBe(1);
    expect(ids[99], "last id").toBe(100);
  });

  const FAILED_ANSWERS: readonly { readonly case: string; readonly answer: GitHubAnswer }[] = [
    { case: "is refused with 401", answer: jsonAnswer(401, { message: "Bad credentials" }) },
    { case: "is refused with 403", answer: jsonAnswer(403, { message: "forbidden" }) },
    { case: "answers 404", answer: jsonAnswer(404, { message: "Not Found" }) },
    { case: "answers 500", answer: jsonAnswer(500, { message: "Server Error" }) },
    {
      case: "is redirected",
      answer: { kind: "raw", status: 302, body: null, headers: { Location: "https://example.com/" } },
    },
    { case: "is rejected by the network", answer: REJECTED },
    { case: "times out", answer: { kind: "reject", error: new DOMException("timed out", "TimeoutError") } },
    { case: "answers text that is not JSON", answer: { kind: "raw", status: 200, body: "not json" } },
    {
      case: "answers more than 1 MiB",
      answer: { kind: "raw", status: 200, body: `"${"a".repeat(MAX_GITHUB_RESPONSE_BYTES)}"` },
    },
    { case: "answers an object instead of a list", answer: jsonAnswer(200, { installations: [] }) },
    {
      case: "answers a list with an entry without an id",
      answer: jsonAnswer(200, [installationEntry({ id: undefined })]),
    },
  ];

  it.each(FAILED_ANSWERS)("listInstallations reports failed when the request $case", async ({ answer }) => {
    const github = githubApiDouble({ installations: answer });

    const result = await listInstallations(github.fetch, VERSION, NOW, await credentials());

    expect(result, "result").toEqual({ kind: "failed" });
  });
});
