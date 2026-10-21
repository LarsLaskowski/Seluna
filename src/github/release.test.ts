import { describe, expect, it } from "vitest";
import { MAX_GITHUB_RESPONSE_BYTES } from "./conversion";
import { fetchLatestRelease, LATEST_RELEASE_PATH, parseLatestRelease, UPSTREAM_REPOSITORY } from "./release";
import type { GitHubAnswer } from "../../test/github";
import {
  FIXTURE_RELEASE_TAG,
  FIXTURES,
  githubApiDouble,
  jsonAnswer,
  latestReleaseBody,
  REJECTED,
} from "../../test/github";

const VERSION = "1.2.3-test";

function latest(answer: GitHubAnswer): Promise<Awaited<ReturnType<typeof fetchLatestRelease>>> {
  const github = githubApiDouble({ latestRelease: answer });
  return fetchLatestRelease(github.fetch, VERSION);
}

describe("release constants", () => {
  it("the release check reads the releases of LarsLaskowski/Seluna", () => {
    expect(UPSTREAM_REPOSITORY, "repository").toBe("LarsLaskowski/Seluna");
    expect(LATEST_RELEASE_PATH, "path").toBe("/repos/LarsLaskowski/Seluna/releases/latest");
  });
});

describe("parseLatestRelease", () => {
  it("parseLatestRelease reads the version of the captured answer", () => {
    expect(FIXTURE_RELEASE_TAG, "fixture tag").toBe("v0.4.0");
    expect(parseLatestRelease(FIXTURES.latestRelease), "version").toEqual({ major: 0, minor: 4, patch: 0 });
  });

  it("parseLatestRelease ignores every field but tag_name", () => {
    const body = { tag_name: "v0.5.0", name: "v9.9.9", html_url: "https://example.com/", body: "v8.8.8" };

    expect(parseLatestRelease(body), "version").toEqual({ major: 0, minor: 5, patch: 0 });
  });

  it.each([
    { name: "an array", body: [] },
    { name: "an array holding an answer", body: [{ tag_name: "v0.5.0" }] },
    { name: "an empty object", body: {} },
    { name: "null", body: null },
    { name: "a string", body: "v0.5.0" },
    { name: "a number", body: 5 },
    { name: "a tag_name that is the number 5", body: { tag_name: 5 } },
    { name: "a tag_name that is null", body: { tag_name: null } },
    { name: "a tag_name that is an array", body: { tag_name: ["v0.5.0"] } },
    { name: "a tag_name that is an object", body: { tag_name: { value: "v0.5.0" } } },
    { name: "a tag_name without the v", body: { tag_name: "0.5.0" } },
    { name: "a pre-release tag", body: { tag_name: "v0.5.0-rc.1" } },
    { name: "a tag with a trailing line feed", body: { tag_name: "v0.5.0\n" } },
    { name: "a tag with a right-to-left override", body: { tag_name: "v0.5.0‮" } },
    { name: "a tag with markup", body: { tag_name: "v0.5.0<b>" } },
    { name: "a tag with a fullwidth digit", body: { tag_name: "v０.5.0" } },
    { name: "a nine-digit overflow", body: { tag_name: "v1000000000.0.0" } },
    { name: "a tag in another field", body: { name: "v0.5.0" } },
  ])("parseLatestRelease returns undefined for $name", ({ body }) => {
    expect(parseLatestRelease(body), "version").toBeUndefined();
  });

  it("parseLatestRelease reads a JSON escape as the character it stands for", () => {
    const body: unknown = JSON.parse(String.raw`{"tag_name": "v0.5.0\u000a"}`);

    expect(parseLatestRelease(body), "version").toBeUndefined();
  });

  it("parseLatestRelease accepts a tag whose digits are written as JSON escapes", () => {
    const body: unknown = JSON.parse(String.raw`{"tag_name": "v0.5.0"}`);

    expect(parseLatestRelease(body), "version").toEqual({ major: 0, minor: 5, patch: 0 });
  });
});

describe("fetchLatestRelease", () => {
  it("fetchLatestRelease returns the version 0.4.0 of the captured answer", async () => {
    const result = await latest(jsonAnswer(200, FIXTURES.latestRelease));

    expect(result, "result").toEqual({ kind: "found", version: { major: 0, minor: 4, patch: 0 } });
  });

  it("fetchLatestRelease sends one public request to the releases/latest path", async () => {
    const github = githubApiDouble({ latestRelease: jsonAnswer(200, FIXTURES.latestRelease) });

    await fetchLatestRelease(github.fetch, VERSION);

    expect(github.requests, "requests").toHaveLength(1);
    expect(github.requests[0]?.route, "route").toBe("latestRelease");
    expect(github.requests[0]?.method, "method").toBe("GET");
    expect(github.requests[0]?.url, "url").toBe("https://api.github.com/repos/LarsLaskowski/Seluna/releases/latest");
    expect(github.requests[0]?.authorization, "authorization").toBeNull();
    expect(github.requests[0]?.headers.get("user-agent"), "user agent").toBe("seluna/1.2.3-test");
    expect(github.requests[0]?.redirect, "redirect").toBe("manual");
    expect(github.requests[0]?.hasBody, "has body").toBe(false);
  });

  it("fetchLatestRelease reports a 404 as none", async () => {
    const result = await latest(jsonAnswer(404, { message: "Not Found" }));

    expect(result, "result").toEqual({ kind: "none" });
  });

  it.each([
    { name: "302", answer: { kind: "raw", status: 302, body: null, headers: { Location: "https://example.com/" } } },
    { name: "403", answer: jsonAnswer(403, { message: "rate limit" }) },
    { name: "429", answer: jsonAnswer(429, { message: "slow down" }) },
    { name: "500", answer: jsonAnswer(500, { message: "oops" }) },
  ] satisfies readonly { readonly name: string; readonly answer: GitHubAnswer }[])(
    "fetchLatestRelease reports a $name answer as refused",
    async ({ answer }) => {
      const result = await latest(answer);

      expect(result, "result").toEqual({ kind: "refused" });
    },
  );

  it("fetchLatestRelease reports a rejected fetch as unavailable", async () => {
    const result = await latest(REJECTED);

    expect(result, "result").toEqual({ kind: "unavailable" });
  });

  it("fetchLatestRelease reports a body over 1 MiB as unavailable", async () => {
    const body = `"${"a".repeat(MAX_GITHUB_RESPONSE_BYTES)}"`;

    const result = await latest({ kind: "raw", status: 200, body });

    expect(result, "result").toEqual({ kind: "unavailable" });
  });

  it("fetchLatestRelease reports invalid JSON as unavailable", async () => {
    const result = await latest({ kind: "raw", status: 200, body: "{not json" });

    expect(result, "result").toEqual({ kind: "unavailable" });
  });

  it.each([
    { name: "an array", body: [] },
    { name: "an empty object", body: {} },
    { name: "a tag_name that is 5", body: latestReleaseBody({ tag_name: 5 }) },
    { name: "a tag_name that is null", body: latestReleaseBody({ tag_name: null }) },
    { name: "a pre-release tag", body: latestReleaseBody({ tag_name: "v0.5.0-rc.1" }) },
  ])("fetchLatestRelease reports $name as malformed", async ({ body }) => {
    const result = await latest(jsonAnswer(200, body));

    expect(result, "result").toEqual({ kind: "malformed" });
  });

  it("fetchLatestRelease does not throw when the fetcher throws", async () => {
    const result = await fetchLatestRelease(() => {
      throw new TypeError("synchronous failure");
    }, VERSION);

    expect(result, "result").toEqual({ kind: "unavailable" });
  });
});
