import type { DeliveryLogEntry } from "./delivery";
import type { GitHubFetch } from "./github/conversion";
import type { ReleaseCheckResult } from "./release-check";
import type { TelegramFetch } from "./telegram";

/** The cron expression of the retry and cleanup run. */
export const RETRY_SCHEDULE = "*/10 * * * *";
/** The cron expression of the daily release check. */
export const RELEASE_SCHEDULE = "17 5 * * *";

export type ScheduledLogEntry =
  | { readonly job: "retry" | "cleanup"; readonly result: "store-failed" }
  | { readonly job: "release-check"; readonly result: ReleaseCheckResult }
  | { readonly job: "schedule"; readonly result: "unknown" };

export interface ScheduledDeps {
  readonly env: object;
  readonly db: D1Database;
  readonly now: () => Date;
  readonly telegramFetch: TelegramFetch;
  readonly githubFetch: GitHubFetch;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly log: (entry: ScheduledLogEntry | DeliveryLogEntry) => void;
  readonly version: string;
}

/** Runs the jobs of the cron expression `cron`. Never rejects. */
export function runScheduled(cron: string, deps: ScheduledDeps): Promise<void> {
  return Promise.reject(new Error("Not implemented"));
}
