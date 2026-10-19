import type { GitHubFetch } from "./conversion";

/** What one GitHub API request came to. */
export type GitHubReply =
  | { readonly kind: "ok"; readonly body: unknown; readonly link: string | null }
  | { readonly kind: "refused"; readonly status: number }
  | { readonly kind: "failed" };

/** The GitHub API request `method` `path` with the standard headers, `Authorization: Bearer <bearer>` and a timeout. */
export function gitHubRequest(method: "GET" | "POST", path: string, version: string, bearer: string): Request {
  void [method, path, version, bearer];
  throw new Error("Not implemented");
}

/** Sends `request` and reads a 2xx answer within the size limit. Never throws. */
export async function sendGitHub(fetcher: GitHubFetch, request: Request): Promise<GitHubReply> {
  await Promise.resolve([fetcher, request]);
  throw new Error("Not implemented");
}
