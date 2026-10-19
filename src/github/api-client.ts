import type { GitHubFetch } from "./conversion";
import { isAccountName } from "./manifest";

export interface GitHubApiDeps {
  readonly env: object;
  readonly db: D1Database;
  readonly fetcher: GitHubFetch;
  readonly now: () => Date;
  readonly version: string;
}

export interface PullRequestRef {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

export type DraftResult = { readonly kind: "ok"; readonly draft: boolean } | { readonly kind: "failed" };

/** The installation id of a webhook payload, or `undefined` unless it is a positive safe integer. */
export function installationIdOf(payload: unknown): number | undefined {
  void payload;
  throw new Error("Not implemented");
}

/** Whether `text` is a repository owner a URL path may carry. */
export function isRepositoryOwner(text: string): boolean {
  return isAccountName(text);
}

/** Whether `text` is a repository name a URL path may carry. */
export function isRepositoryName(text: string): boolean {
  void text;
  throw new Error("Not implemented");
}

/** The `draft` flag of a pull request answer, or `undefined` when it has another shape. */
export function parsePullRequestDraft(body: unknown): boolean | undefined {
  void body;
  throw new Error("Not implemented");
}

/** Whether the pull request is a draft, asked of GitHub as the installation. Never throws. */
export async function isPullRequestDraft(
  deps: GitHubApiDeps,
  installationId: number,
  pullRequest: PullRequestRef,
): Promise<DraftResult> {
  await Promise.resolve([deps, installationId, pullRequest]);
  throw new Error("Not implemented");
}
