/** `meta` key of the setup login's failed-attempt count. */
export const LOGIN_ATTEMPTS_META_KEY = "login_attempts";
/** Failed attempts after which the login is locked. */
export const MAX_FAILED_LOGINS = 5;
/** How long the lock lasts after the fifth failure, and how long a count is kept: 15 minutes. */
export const LOGIN_LOCK_MS = 900_000;

/** Whether a counted attempt may have its secret checked. */
export type LoginAttempt = "allowed" | "locked";

// One statement, so concurrent attempts are counted one after the other. A missing, malformed or old count starts
// again; below the maximum the count grows with `last` = now; at the maximum it grows and `last` stays, so a
// rejected attempt does not extend the lock. CAST because a bound number may arrive as REAL.
const RESERVE_SQL = `INSERT INTO meta (key, value) VALUES (?1, json_object('failures', 1, 'last', CAST(?2 AS INTEGER)))
ON CONFLICT (key) DO UPDATE SET value = CASE
  WHEN json_valid(meta.value) = 0 THEN excluded.value
  WHEN json_type(meta.value, '$.failures') IS NOT 'integer'
    OR json_type(meta.value, '$.last') IS NOT 'integer' THEN excluded.value
  WHEN json_extract(meta.value, '$.failures') < 0 THEN excluded.value
  WHEN CAST(?2 AS INTEGER) - json_extract(meta.value, '$.last') >= ?3 THEN excluded.value
  WHEN json_extract(meta.value, '$.failures') < ?4
    THEN json_object('failures', json_extract(meta.value, '$.failures') + 1, 'last', CAST(?2 AS INTEGER))
  ELSE json_object('failures', json_extract(meta.value, '$.failures') + 1, 'last', json_extract(meta.value, '$.last'))
END
RETURNING json_extract(value, '$.failures') AS failures`;

/** Counts one login attempt at `now` in one atomic statement and says whether its secret may be checked. D1 errors are not caught. */
export async function reserveLoginAttempt(db: D1Database, now: Date): Promise<LoginAttempt> {
  const row = await db
    .prepare(RESERVE_SQL)
    .bind(LOGIN_ATTEMPTS_META_KEY, now.getTime(), LOGIN_LOCK_MS, MAX_FAILED_LOGINS)
    .first();
  const failures = row?.failures;
  // Fail closed: anything but an integer within the allowed count is a lock.
  return typeof failures === "number" && Number.isInteger(failures) && failures <= MAX_FAILED_LOGINS
    ? "allowed"
    : "locked";
}

/** Deletes the count after a successful login. D1 errors are not caught. */
export async function clearLoginAttempts(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM meta WHERE key = ?1").bind(LOGIN_ATTEMPTS_META_KEY).run();
}
