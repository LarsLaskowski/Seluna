export const SESSION_COOKIE = "seluna_session";
/** 12 hours. */
export const SESSION_LIFETIME_MS = 43_200_000;

/** `v1.<expires>.<mac>` for a session that expires 12 hours after `now`; `key` from `signingKeyFromEnv(env, "setup-session")`. */
export function createSessionToken(key: CryptoKey, now: Date): Promise<string> {
  throw new Error("Not implemented");
}

/** Whether `token` has exactly the session form, its MAC verifies under `key`, and `now < expires <= now + 12 hours`. */
export function isValidSessionToken(key: CryptoKey, token: string, now: Date): Promise<boolean> {
  throw new Error("Not implemented");
}
