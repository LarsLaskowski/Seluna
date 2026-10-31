/* eslint-disable @typescript-eslint/no-unused-vars -- skeleton: the bodies arrive with the implementation */
import type { DigestSummary } from "../digest";
import type { ActivityEvent, StarRemoval } from "../rules/rule";

/** How long collected activity is kept: seven days in milliseconds. */
export const ACTIVITY_RETENTION_MS = 604_800_000;

/** The insert of `event` into `activity`, with `createdAt` as its time, for a batch. */
export function activityInsert(db: D1Database, event: ActivityEvent, createdAt: Date): D1PreparedStatement {
  throw new Error("not implemented");
}

/** The delete of the star rows of `removal`'s account in its repository, for a batch. */
export function starRemovalDelete(db: D1Database, removal: StarRemoval): D1PreparedStatement {
  throw new Error("not implemented");
}

/**
 * The summary of the activity rows created at or after `notBefore`, or `undefined` for an empty table.
 * D1 errors are not caught.
 */
export function readDigestSummary(db: D1Database, notBefore: Date): Promise<DigestSummary | undefined> {
  return Promise.reject(new Error("not implemented"));
}

/** The delete of every `activity` row with an id up to `maxId`, for a batch. */
export function countedActivityDelete(db: D1Database, maxId: number): D1PreparedStatement {
  throw new Error("not implemented");
}

/** The bounded delete of `activity` rows created before `createdBefore`, oldest first, for a batch. */
export function oldActivityDelete(db: D1Database, createdBefore: Date, limit: number): D1PreparedStatement {
  throw new Error("not implemented");
}
