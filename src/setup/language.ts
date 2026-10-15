import { cookieValues } from "./cookies";

export type Language = "en" | "de";
export const LANGUAGE_COOKIE = "seluna_lang";
export const LANGUAGE_PARAMETER = "lang";
/** One year, in seconds. */
export const LANGUAGE_COOKIE_MAX_AGE = 31_536_000;

const WEIGHT_FORM = /^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i;

/** `value` when it is exactly `en` or `de`, otherwise `undefined`. */
export function parseLanguage(value: string | null | undefined): Language | undefined {
  return value === "en" || value === "de" ? value : undefined;
}

/** The weight of one `Accept-Language` entry (its parameter text, if any), or `undefined` when it does not fit the grammar. */
function weightOf(parameter: string | undefined): number | undefined {
  if (parameter === undefined) {
    return 1;
  }
  const match = WEIGHT_FORM.exec(parameter);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** The language `Accept-Language` prefers (RFC 9110 §12.5.4, rules in the area document), English when it names neither. */
export function languageFromAcceptLanguage(header: string | null): Language {
  let best: Language = "en";
  let bestWeight = 0;
  if (header === null) {
    return best;
  }
  // Each entry is split and checked on its own, so the time stays proportional to the header's length.
  for (const entry of header.split(",")) {
    const [range = "", parameter, ...rest] = entry.split(";").map((part) => part.trim());
    const dash = range.indexOf("-");
    const language = parseLanguage((dash < 0 ? range : range.slice(0, dash)).toLowerCase());
    const weight = rest.length === 0 && language !== undefined ? weightOf(parameter) : undefined;
    if (language !== undefined && weight !== undefined && weight > bestWeight) {
      best = language;
      bestWeight = weight;
    }
  }
  return best;
}

/** The language of the response, and whether it came from the `lang` query parameter (then the cookie is set). */
export function resolveLanguage(request: Request): { readonly language: Language; readonly fromQuery: boolean } {
  const fromQuery = parseLanguage(new URL(request.url).searchParams.get(LANGUAGE_PARAMETER));
  if (fromQuery !== undefined) {
    return { language: fromQuery, fromQuery: true };
  }
  const fromCookie = cookieValues(request.headers.get("cookie"), LANGUAGE_COOKIE)
    .map((value) => parseLanguage(value))
    .find((language) => language !== undefined);
  return {
    language: fromCookie ?? languageFromAcceptLanguage(request.headers.get("accept-language")),
    fromQuery: false,
  };
}
