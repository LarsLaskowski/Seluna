import { cleanUpRows } from "./cleanup";
import type { DeliveryLogEntry } from "./delivery";
import { retryPendingRows } from "./outbox-retry";
import { checkForRelease } from "./release-check";
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

/** Calls the log sink; a throwing sink must never stop a job, so its error is dropped. */
function safeLog(deps: ScheduledDeps, entry: ScheduledLogEntry | DeliveryLogEntry): void {
  try {
    deps.log(entry);
  } catch {
    // The sink failed; nothing else can report it.
  }
}

async function runRetryAndCleanup(startedAt: Date, deps: ScheduledDeps): Promise<void> {
  try {
    await cleanUpRows(deps.db, startedAt);
  } catch {
    // The error is dropped: only the fixed result reaches the log.
    safeLog(deps, { job: "cleanup", result: "store-failed" });
  }
  const result = await retryPendingRows(startedAt, {
    env: deps.env,
    db: deps.db,
    fetch: deps.telegramFetch,
    sleep: deps.sleep,
    log: (entry) => {
      safeLog(deps, entry);
    },
    now: deps.now,
  });
  if (result === "store-failed") {
    safeLog(deps, { job: "retry", result });
  }
}

async function runReleaseCheck(startedAt: Date, deps: ScheduledDeps): Promise<void> {
  const result = await checkForRelease(startedAt, {
    env: deps.env,
    db: deps.db,
    fetch: deps.telegramFetch,
    githubFetch: deps.githubFetch,
    sleep: deps.sleep,
    log: (entry) => {
      safeLog(deps, entry);
    },
    now: deps.now,
    version: deps.version,
  });
  safeLog(deps, { job: "release-check", result });
}

/** Runs the jobs of the cron expression `cron`. Never rejects. */
export async function runScheduled(cron: string, deps: ScheduledDeps): Promise<void> {
  try {
    switch (cron) {
      case RETRY_SCHEDULE:
        await runRetryAndCleanup(deps.now(), deps);
        break;
      case RELEASE_SCHEDULE:
        await runReleaseCheck(deps.now(), deps);
        break;
      default:
        safeLog(deps, { job: "schedule", result: "unknown" });
    }
  } catch {
    // Each job reports its own failures; whatever is left must not reject the handler.
  }
}
