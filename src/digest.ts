import type { StoredNotification } from "./notification";
import type { Language } from "./setup/language";

/** One repository's line of the activity digest. */
export interface DigestRepository {
  readonly repositoryId: number;
  readonly repository: string;
  readonly repositoryUrl: string | undefined;
  readonly stars: number;
  readonly forks: number;
  /** The star count of the newest collected star; `undefined` when none is known. */
  readonly starCount: number | undefined;
  /** The number of distinct accounts. */
  readonly accounts: number;
  /** The first events' account logins, at most `DIGEST_MAX_NAMES`. */
  readonly names: readonly string[];
}

/** The collected activity a digest reports. */
export interface DigestSummary {
  /** The largest `activity` id the summary counts; rows up to it are deleted when the digest is committed. */
  readonly maxId: number;
  readonly repositories: readonly DigestRepository[];
  /** The number of repositories with activity, which may exceed `repositories.length`. */
  readonly totalRepositories: number;
}

/** The most repositories a digest lists. */
export const DIGEST_MAX_REPOSITORIES = 10;
/** The most account names a repository line lists. */
export const DIGEST_MAX_NAMES = 5;

/**
 * The activity digest of `summary` in `language`, and the button URL (the repository's `buttonUrl` for exactly one
 * repository, otherwise `undefined`).
 */
export function digestNotification(
  summary: DigestSummary,
  language: Language,
): { readonly notification: StoredNotification; readonly buttonUrl: string | undefined } {
  throw new Error(`not implemented: ${String(summary.maxId)} ${language}`);
}
