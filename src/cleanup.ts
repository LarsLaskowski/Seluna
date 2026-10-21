/** `deliveries` rows are kept for 7 days. */
export const DELIVERY_RETENTION_MS = 604_800_000;
/** Finished `outbox` rows are kept for 30 days. */
export const OUTBOX_RETENTION_MS = 2_592_000_000;
/** Most rows one cleanup deletes per table. */
export const CLEANUP_LIMIT = 1000;

/** One batch of three bounded deletes. D1 errors reject. */
export function cleanUpRows(db: D1Database, startedAt: Date): Promise<void> {
  return Promise.reject(new Error("Not implemented"));
}
