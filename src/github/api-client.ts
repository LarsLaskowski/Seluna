import { keyFromEnv } from "../crypto";
import { deleteCachedToken } from "../store/token-cache";
import { resolveAppCredentials } from "./app-credentials";
import type { GitHubFetch } from "./conversion";
import { gitHubRequest, sendGitHub } from "./http";
import { installationToken } from "./installation-token";
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

const REPOSITORY_NAME = /^[\w.-]{1,100}$/;
const UNAUTHORIZED = 401;
const FAILED: DraftResult = { kind: "failed" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** The installation id of a webhook payload, or `undefined` unless it is a positive safe integer. */
export function installationIdOf(payload: unknown): number | undefined {
  if (!isRecord(payload) || !isRecord(payload.installation)) {
    return undefined;
  }
  const { id } = payload.installation;
  return isPositiveSafeInteger(id) ? id : undefined;
}

/** Whether `text` is a repository owner a URL path may carry. */
export function isRepositoryOwner(text: string): boolean {
  return isAccountName(text);
}

/** Whether `text` is a repository name a URL path may carry. */
export function isRepositoryName(text: string): boolean {
  return REPOSITORY_NAME.test(text) && text !== "." && text !== "..";
}

/** The `draft` flag of a pull request answer, or `undefined` when it has another shape. */
export function parsePullRequestDraft(body: unknown): boolean | undefined {
  return isRecord(body) && typeof body.draft === "boolean" ? body.draft : undefined;
}

async function readDraft(
  deps: GitHubApiDeps,
  installationId: number,
  pullRequest: PullRequestRef,
): Promise<DraftResult> {
  const credentials = await resolveAppCredentials(deps.env, deps.db);
  if (credentials.kind !== "ok") {
    return FAILED;
  }
  const storageKey = await keyFromEnv(deps.env);
  if (storageKey === undefined) {
    return FAILED;
  }
  const issued = await installationToken(
    { db: deps.db, storageKey, fetcher: deps.fetcher, now: deps.now, version: deps.version },
    credentials.credentials,
    installationId,
  );
  if (issued === undefined) {
    return FAILED;
  }
  const path = `/repos/${pullRequest.owner}/${pullRequest.repo}/pulls/${String(pullRequest.number)}`;
  const reply = await sendGitHub(deps.fetcher, gitHubRequest("GET", path, deps.version, issued.token));
  if (reply.kind === "refused" && reply.status === UNAUTHORIZED) {
    // GitHub revoked this token: drop the row that still holds it, so the next call requests a new one.
    await deleteCachedToken(deps.db, installationId, issued.iv);
    return FAILED;
  }
  const draft = reply.kind === "ok" ? parsePullRequestDraft(reply.body) : undefined;
  return draft === undefined ? FAILED : { kind: "ok", draft };
}

/** Whether the pull request is a draft, asked of GitHub as the installation. Never throws. */
export async function isPullRequestDraft(
  deps: GitHubApiDeps,
  installationId: number,
  pullRequest: PullRequestRef,
): Promise<DraftResult> {
  if (
    !isPositiveSafeInteger(installationId) ||
    !isPositiveSafeInteger(pullRequest.number) ||
    !isRepositoryOwner(pullRequest.owner) ||
    !isRepositoryName(pullRequest.repo)
  ) {
    return FAILED;
  }
  try {
    return await readDraft(deps, installationId, pullRequest);
  } catch {
    // D1 errors, a throwing clock or fetch: every failure is the same result and carries no cause.
    return FAILED;
  }
}
