import type { DeliveryDeps } from "./delivery";

/** Most rows one retry run sends. */
export const RETRY_BATCH_SIZE = 10;
/** A row is due once it was written this long before the run started. */
export const RETRY_GRACE_MS = 60_000;

export type RetryResult = "done" | "store-failed";

/** Marks exhausted rows `failed`, then sends the oldest due rows once. Never rejects. */
export function retryPendingRows(startedAt: Date, deps: DeliveryDeps): Promise<RetryResult> {
  return Promise.reject(new Error("Not implemented"));
}
