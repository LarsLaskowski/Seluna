import type { NewOutboxRow } from "./outbox";

/** `meta` key of the newest release version that was reported, `A.B.C`. */
export const NOTIFIED_RELEASE_META_KEY = "notified_release";

/** The remembered release version as stored, or `undefined` when none is. D1 errors reject. */
export function readNotifiedRelease(db: D1Database): Promise<string | undefined> {
  return Promise.reject(new Error("Not implemented"));
}

/** One guarded batch; the new row's id, or `undefined` when `notified_release` no longer holds `expected`. D1 errors reject. */
export function recordReleaseNotice(
  db: D1Database,
  row: NewOutboxRow,
  createdAt: Date,
  notified: string,
  expected: string | undefined,
): Promise<number | undefined> {
  return Promise.reject(new Error("Not implemented"));
}
