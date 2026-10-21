import { oldDeliveriesDelete } from "./store/deliveries";
import { finishedRowsDelete } from "./store/outbox";
import { expiredTokensDelete } from "./store/token-cache";

/** `deliveries` rows are kept for 7 days. */
export const DELIVERY_RETENTION_MS = 604_800_000;
/** Finished `outbox` rows are kept for 30 days. */
export const OUTBOX_RETENTION_MS = 2_592_000_000;
/** Most rows one cleanup deletes per table. */
export const CLEANUP_LIMIT = 1000;

/** One batch of three bounded deletes. D1 errors reject. */
export async function cleanUpRows(db: D1Database, startedAt: Date): Promise<void> {
  const now = startedAt.getTime();
  await db.batch([
    oldDeliveriesDelete(db, new Date(now - DELIVERY_RETENTION_MS), CLEANUP_LIMIT),
    finishedRowsDelete(db, new Date(now - OUTBOX_RETENTION_MS), CLEANUP_LIMIT),
    expiredTokensDelete(db, startedAt, CLEANUP_LIMIT),
  ]);
}
