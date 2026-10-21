import type { NewOutboxRow } from "./outbox";

/** `meta` key of the newest release version that was reported, `A.B.C`. */
export const NOTIFIED_RELEASE_META_KEY = "notified_release";

/** The remembered release version as stored, or `undefined` when none is. D1 errors reject. */
export async function readNotifiedRelease(db: D1Database): Promise<string | undefined> {
  const row = await db.prepare("SELECT value FROM meta WHERE key = ?1").bind(NOTIFIED_RELEASE_META_KEY).first();
  const value = row?.value;
  return typeof value === "string" ? value : undefined;
}

const REMEMBERED = "COALESCE((SELECT value FROM meta WHERE key = 'notified_release'), '')";

/** One guarded batch; the new row's id, or `undefined` when `notified_release` no longer holds `expected`. D1 errors reject. */
export async function recordReleaseNotice(
  db: D1Database,
  row: NewOutboxRow,
  createdAt: Date,
  notified: string,
  expected: string | undefined = "",
): Promise<number | undefined> {
  // Both guards read the same state: the insert into `outbox` does not touch `meta`.
  const [inserted] = await db.batch([
    db
      .prepare(
        "INSERT INTO outbox (text, button_url, silent, created_at) " +
          `SELECT ?1, ?2, 0, ?3 WHERE ${REMEMBERED} = ?4 RETURNING id`,
      )
      .bind(row.text, row.buttonUrl ?? null, createdAt.getTime(), expected),
    db
      .prepare(
        "INSERT INTO meta (key, value) " +
          `SELECT 'notified_release', ?1 WHERE ${REMEMBERED} = ?2 ` +
          "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      )
      .bind(notified, expected),
  ]);
  const created: unknown = inserted?.results[0];
  return typeof created === "object" && created !== null && "id" in created && typeof created.id === "number"
    ? created.id
    : undefined;
}
