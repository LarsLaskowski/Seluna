export const CSRF_COOKIE = "seluna_csrf";
export const CSRF_FIELD = "csrf";

/** 32 random bytes as base64url without padding (43 characters). */
export function newCsrfCookieValue(): string {
  throw new Error("Not implemented");
}

/** Whether `value` has the form of a CSRF cookie value (43 base64url characters). */
export function isWellFormedCsrfCookieValue(value: string): boolean {
  throw new Error("Not implemented");
}

/** The form token of a CSRF cookie value: HMAC-SHA256 of its UTF-8 bytes under `key` (from `signingKeyFromEnv(env, "setup-csrf")`), base64url without padding. */
export function csrfTokenFor(key: CryptoKey, cookieValue: string): Promise<string> {
  throw new Error("Not implemented");
}

/** Whether `token` verifies, in constant time, against one of the first four well-formed values in `cookieValues`. */
export function isValidCsrfToken(
  key: CryptoKey,
  token: string | null,
  cookieValues: readonly string[],
): Promise<boolean> {
  throw new Error("Not implemented");
}
