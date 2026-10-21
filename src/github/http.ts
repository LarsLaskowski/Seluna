import { readJsonWithLimit } from "../body";
import { GITHUB_API_ORIGIN, GITHUB_API_VERSION, GITHUB_TIMEOUT_MS, MAX_GITHUB_RESPONSE_BYTES } from "./conversion";
import type { GitHubFetch } from "./conversion";

/** What one GitHub API request came to. */
export type GitHubReply =
  | { readonly kind: "ok"; readonly body: unknown; readonly link: string | null }
  | { readonly kind: "refused"; readonly status: number }
  | { readonly kind: "failed" };

/** The GitHub API request `method` `path` with the standard headers, `Authorization: Bearer <bearer>` and a timeout. */
export function gitHubRequest(method: "GET" | "POST", path: string, version: string, bearer: string): Request {
  return new Request(`${GITHUB_API_ORIGIN}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": `seluna/${version}`,
      Authorization: `Bearer ${bearer}`,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
}

/** GET `path` on the GitHub API with the standard headers, no `Authorization`, no redirects, a 10-second timeout. */
export function publicGitHubRequest(path: string, version: string): Request {
  return new Request(`${GITHUB_API_ORIGIN}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": `seluna/${version}`,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
}

/** Sends `request` and reads a 2xx answer within the size limit. Never throws. */
export async function sendGitHub(fetcher: GitHubFetch, request: Request): Promise<GitHubReply> {
  try {
    const response = await fetcher(request);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { kind: "refused", status: response.status };
    }
    const body = await readJsonWithLimit(response, MAX_GITHUB_RESPONSE_BYTES);
    return body === undefined ? { kind: "failed" } : { kind: "ok", body, link: response.headers.get("link") };
  } catch {
    // Network errors, timeouts and aborts carry nothing the caller can use; the cause is dropped.
    return { kind: "failed" };
  }
}
