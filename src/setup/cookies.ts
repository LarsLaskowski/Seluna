/** The path every wizard cookie is scoped to. */
export const SETUP_COOKIE_PATH = "/setup";
/** At most this many values per cookie name are looked at. */
export const MAX_COOKIE_VALUES = 4;

/** Every value of the cookie `name` in a `Cookie` header, in header order: pairs split at `;`, name and value trimmed of spaces, the value neither unquoted nor decoded. */
export function cookieValues(header: string | null, name: string): readonly string[] {
  const values: string[] = [];
  if (header === null) {
    return values;
  }
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator >= 0 && pair.slice(0, separator).trim() === name) {
      values.push(pair.slice(separator + 1).trim());
      if (values.length === MAX_COOKIE_VALUES) {
        break;
      }
    }
  }
  return values;
}

/** A `Set-Cookie` value: `<name>=<value>`, then `; Max-Age=<n>` when given, then `; Path=/setup; HttpOnly; Secure; SameSite=Strict`. */
export function setupCookie(name: string, value: string, maxAgeSeconds?: number): string {
  const maxAge = maxAgeSeconds === undefined ? "" : `; Max-Age=${String(maxAgeSeconds)}`;
  return `${name}=${value}${maxAge}; Path=${SETUP_COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict`;
}
