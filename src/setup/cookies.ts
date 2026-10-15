/** The path every wizard cookie is scoped to. */
export const SETUP_COOKIE_PATH = "/setup";
/** At most this many values per cookie name are looked at. */
export const MAX_COOKIE_VALUES = 4;

/** Every value of the cookie `name` in a `Cookie` header, in header order: pairs split at `;`, name and value trimmed of spaces, the value neither unquoted nor decoded. */
export function cookieValues(header: string | null, name: string): readonly string[] {
  throw new Error("Not implemented");
}

/** A `Set-Cookie` value: `<name>=<value>`, then `; Max-Age=<n>` when given, then `; Path=/setup; HttpOnly; Secure; SameSite=Strict`. */
export function setupCookie(name: string, value: string, maxAgeSeconds?: number): string {
  throw new Error("Not implemented");
}
