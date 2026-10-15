import { fromBase64Url, toBase64Url } from "../base64url";
import { MAX_COOKIE_VALUES } from "./cookies";

export const CSRF_COOKIE = "seluna_csrf";
export const CSRF_FIELD = "csrf";

const CSRF_COOKIE_VALUE_BYTES = 32;
const CSRF_COOKIE_VALUE_FORM = /^[\w-]{43}$/;

function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(text));
}

/** 32 random bytes as base64url without padding (43 characters). */
export function newCsrfCookieValue(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(CSRF_COOKIE_VALUE_BYTES)));
}

/** Whether `value` has the form of a CSRF cookie value (43 base64url characters). */
export function isWellFormedCsrfCookieValue(value: string): boolean {
  return CSRF_COOKIE_VALUE_FORM.test(value);
}

/** The form token of a CSRF cookie value: HMAC-SHA256 of its UTF-8 bytes under `key` (from `signingKeyFromEnv(env, "setup-csrf")`), base64url without padding. */
export async function csrfTokenFor(key: CryptoKey, cookieValue: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(cookieValue))));
}

/** Whether `token` verifies, in constant time, against one of the first four well-formed values in `cookieValues`. */
export async function isValidCsrfToken(
  key: CryptoKey,
  token: string | null,
  cookieValues: readonly string[],
): Promise<boolean> {
  const mac = token === null ? undefined : fromBase64Url(token);
  if (mac === undefined) {
    return false;
  }
  const candidates = cookieValues.filter(isWellFormedCsrfCookieValue).slice(0, MAX_COOKIE_VALUES);
  // Every candidate is checked, so the time does not tell which cookie value matched.
  const results = await Promise.all(candidates.map((value) => crypto.subtle.verify("HMAC", key, mac, utf8(value))));
  return results.includes(true);
}
