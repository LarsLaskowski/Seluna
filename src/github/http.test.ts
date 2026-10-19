import { afterEach, describe, expect, it, vi } from "vitest";
import { GITHUB_TIMEOUT_MS, MAX_GITHUB_RESPONSE_BYTES } from "./conversion";
import type { GitHubFetch } from "./conversion";
import { gitHubRequest, sendGitHub } from "./http";
import { githubApiDouble, jsonAnswer, REJECTED } from "../../test/github";
import type { GitHubAnswer } from "../../test/github";

const VERSION = "1.2.3-test";
const INSTALLATIONS_PATH = "/app/installations?per_page=100";

afterEach(() => {
  vi.restoreAllMocks();
});

function request(path = INSTALLATIONS_PATH): Request {
  return gitHubRequest("GET", path, VERSION, "bearer-value");
}

/** A JSON text of exactly `bytes` bytes: a string of letters in quotes. */
function jsonTextOfBytes(bytes: number): string {
  return `"${"a".repeat(bytes - 2)}"`;
}

describe("gitHubRequest", () => {
  it("gitHubRequest sets Accept, X-GitHub-Api-Version, User-Agent seluna/<version> and the Bearer authorization", () => {
    const built = gitHubRequest("GET", INSTALLATIONS_PATH, VERSION, "bearer-value");

    expect(built.headers.get("accept"), "Accept").toBe("application/vnd.github+json");
    expect(built.headers.get("x-github-api-version"), "X-GitHub-Api-Version").toBe("2022-11-28");
    expect(built.headers.get("user-agent"), "User-Agent").toBe("seluna/1.2.3-test");
    expect(built.headers.get("authorization"), "Authorization").toBe("Bearer bearer-value");
  });

  it.each([
    { method: "GET" as const, path: "/repos/octocat/hello-world/pulls/42" },
    { method: "POST" as const, path: "/app/installations/1000003/access_tokens" },
  ])("gitHubRequest builds $method https://api.github.com$path", ({ method, path }) => {
    const built = gitHubRequest(method, path, VERSION, "bearer-value");

    expect(built.method, "method").toBe(method);
    expect(built.url, "url").toBe(`https://api.github.com${path}`);
    expect(built.body, "body").toBeNull();
  });

  it("gitHubRequest does not follow redirects", () => {
    const built = request();

    expect(built.redirect, "redirect").toBe("manual");
  });

  it("gitHubRequest carries a timeout signal of 10 seconds that has not fired", () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");

    const built = request();

    expect(GITHUB_TIMEOUT_MS, "timeout constant").toBe(10_000);
    expect(timeout, "AbortSignal.timeout calls").toHaveBeenCalledExactlyOnceWith(10_000);
    expect(built.signal.aborted, "signal aborted").toBe(false);
  });
});

describe("sendGitHub", () => {
  it.each([200, 201])("sendGitHub reads the JSON body of a %i answer", async (status) => {
    const github = githubApiDouble({ installations: jsonAnswer(status, [{ id: 1 }]) });

    const reply = await sendGitHub(github.fetch, request());

    expect(reply, "reply").toEqual({ kind: "ok", body: [{ id: 1 }], link: null });
  });

  it("sendGitHub hands over the Link header of the answer", async () => {
    const link = '<https://api.github.com/app/installations?per_page=100&page=2>; rel="next"';
    const github = githubApiDouble({ installations: jsonAnswer(200, [], { Link: link }) });

    const reply = await sendGitHub(github.fetch, request());

    expect(reply, "reply").toEqual({ kind: "ok", body: [], link });
  });

  it("sendGitHub sends the request it was given", async () => {
    const github = githubApiDouble({ installations: jsonAnswer(200, []) });
    const built = request();

    await sendGitHub(github.fetch, built);

    expect(github.fetch, "fetch calls").toHaveBeenCalledExactlyOnceWith(built);
  });

  it.each([400, 401, 403, 404, 422, 500, 502])(
    "sendGitHub reports a %i answer as refused with its status",
    async (status) => {
      const github = githubApiDouble({ installations: jsonAnswer(status, { message: "secret text of GitHub" }) });

      const reply = await sendGitHub(github.fetch, request());

      expect(reply, "reply").toEqual({ kind: "refused", status });
    },
  );

  it("sendGitHub reports a redirect as refused with its status", async () => {
    const github = githubApiDouble({
      installations: { kind: "raw", status: 302, body: null, headers: { Location: "https://example.com/" } },
    });

    const reply = await sendGitHub(github.fetch, request());

    expect(reply, "reply").toEqual({ kind: "refused", status: 302 });
  });

  it("sendGitHub cancels the body of a refused answer", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
      },
      cancel: cancelled,
    });
    const fetcher: GitHubFetch = () => Promise.resolve(new Response(body, { status: 404 }));

    const reply = await sendGitHub(fetcher, request());

    expect(reply, "reply").toEqual({ kind: "refused", status: 404 });
    expect(cancelled, "cancel calls").toHaveBeenCalledOnce();
  });

  it("sendGitHub reports a rejected fetch as failed", async () => {
    const github = githubApiDouble({ installations: REJECTED });

    const reply = await sendGitHub(github.fetch, request());

    expect(reply, "reply").toEqual({ kind: "failed" });
  });

  it("sendGitHub reports a timeout as failed", async () => {
    const timedOut: GitHubAnswer = {
      kind: "reject",
      error: new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    };
    const github = githubApiDouble({ installations: timedOut });

    const reply = await sendGitHub(github.fetch, request());

    expect(reply, "reply").toEqual({ kind: "failed" });
  });

  it("sendGitHub reports a fetch that throws instead of returning a promise as failed", async () => {
    const fetcher: GitHubFetch = () => {
      throw new Error("synchronous failure");
    };

    const reply = await sendGitHub(fetcher, request());

    expect(reply, "reply").toEqual({ kind: "failed" });
  });

  it.each<{ case: string; answer: GitHubAnswer }>([
    { case: "text that is not JSON", answer: { kind: "raw", status: 200, body: "not json" } },
    { case: "an empty body", answer: { kind: "raw", status: 200, body: "" } },
    {
      case: "a body that is not UTF-8",
      answer: { kind: "raw", status: 200, body: new Uint8Array([0x22, 0xff, 0x22]) },
    },
    {
      case: "a body of more than 1 MiB",
      answer: { kind: "raw", status: 200, body: jsonTextOfBytes(MAX_GITHUB_RESPONSE_BYTES + 1) },
    },
  ])("sendGitHub reports a 2xx answer with $case as failed", async ({ answer }) => {
    const github = githubApiDouble({ installations: answer });

    const reply = await sendGitHub(github.fetch, request());

    expect(reply, "reply").toEqual({ kind: "failed" });
  });

  it("sendGitHub reads a body of exactly 1 MiB", async () => {
    const text = jsonTextOfBytes(MAX_GITHUB_RESPONSE_BYTES);
    const github = githubApiDouble({ installations: { kind: "raw", status: 200, body: text } });

    const reply = await sendGitHub(github.fetch, request());

    expect(reply.kind, "reply kind").toBe("ok");
  });
});
