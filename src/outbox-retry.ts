import { deliverMessages } from "./delivery";
import type { DeliveryDeps } from "./delivery";
import { failExhaustedRows, readDueRows } from "./store/outbox";
import { readNotificationSettings } from "./store/settings";

/** Most rows one retry run sends. */
export const RETRY_BATCH_SIZE = 10;
/** A row is due once it was written this long before the run started. */
export const RETRY_GRACE_MS = 60_000;

export type RetryResult = "done" | "store-failed";

/** Logs without letting a failing sink stop the run. */
function logFailed(deps: DeliveryDeps, id: number): void {
  try {
    deps.log({ outbox: id, status: "failed" });
  } catch {
    // A failing log sink must not stop the run.
  }
}

/** Marks exhausted rows `failed`, then sends the oldest due rows once. Never rejects. */
export async function retryPendingRows(startedAt: Date, deps: DeliveryDeps): Promise<RetryResult> {
  try {
    const failed = await failExhaustedRows(deps.db, RETRY_BATCH_SIZE);
    for (const id of failed) {
      logFailed(deps, id);
    }
    const due = await readDueRows(deps.db, new Date(startedAt.getTime() - RETRY_GRACE_MS), RETRY_BATCH_SIZE);
    if (due.length === 0) {
      return "done";
    }
    const settings = await readNotificationSettings(deps.db);
    await deliverMessages(due, settings, deps);
    return "done";
  } catch {
    // The error is dropped: only the fixed result reaches the log.
    return "store-failed";
  }
}
