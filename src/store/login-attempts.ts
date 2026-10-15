/** `meta` key of the setup login's failed-attempt count. */
export const LOGIN_ATTEMPTS_META_KEY = "login_attempts";
/** Failed attempts after which the login is locked. */
export const MAX_FAILED_LOGINS = 5;
/** How long the lock lasts after the fifth failure, and how long a count is kept: 15 minutes. */
export const LOGIN_LOCK_MS = 900_000;

/** Whether a counted attempt may have its secret checked. */
export type LoginAttempt = "allowed" | "locked";

/** Counts one login attempt at `now` in one atomic statement and says whether its secret may be checked. D1 errors are not caught. */
export function reserveLoginAttempt(db: D1Database, now: Date): Promise<LoginAttempt> {
  throw new Error("Not implemented");
}

/** Deletes the count after a successful login. D1 errors are not caught. */
export function clearLoginAttempts(db: D1Database): Promise<void> {
  throw new Error("Not implemented");
}
