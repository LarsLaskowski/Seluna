export type Language = "en" | "de";
export const LANGUAGE_COOKIE = "seluna_lang";
export const LANGUAGE_PARAMETER = "lang";
/** One year, in seconds. */
export const LANGUAGE_COOKIE_MAX_AGE = 31_536_000;

/** `value` when it is exactly `en` or `de`, otherwise `undefined`. */
export function parseLanguage(value: string | null | undefined): Language | undefined {
  throw new Error("Not implemented");
}

/** The language `Accept-Language` prefers (RFC 9110 §12.5.4, rules in the area document), English when it names neither. */
export function languageFromAcceptLanguage(header: string | null): Language {
  throw new Error("Not implemented");
}

/** The language of the response, and whether it came from the `lang` query parameter (then the cookie is set). */
export function resolveLanguage(request: Request): { readonly language: Language; readonly fromQuery: boolean } {
  throw new Error("Not implemented");
}
