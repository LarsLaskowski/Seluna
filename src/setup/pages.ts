import type { Language } from "./language";
import type { Notice } from "./texts";

/** The content of every page's single `<style>` element. */
export const STYLE = "";

/** `text` with `&`, `<`, `>`, `"` and `'` replaced by character references. */
export function escapeHtml(text: string): string {
  throw new Error("Not implemented");
}

/** `default-src 'none'; style-src 'sha256-<base64 SHA-256 of STYLE>'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`. */
export function contentSecurityPolicy(): Promise<string> {
  throw new Error("Not implemented");
}

/** Each page links to exactly `/setup?lang=en` and `/setup?lang=de`, whatever path it is answered on. */
export function renderLoginPage(language: Language, csrfToken: string, notice?: Notice): string {
  throw new Error("Not implemented");
}

/** The start page of the signed-in owner; links like the login page. */
export function renderStartPage(language: Language, csrfToken: string, notice?: Notice): string {
  throw new Error("Not implemented");
}

/** The page that explains how to set `SELUNA_SECRET`; links like the login page. */
export function renderNotConfiguredPage(language: Language): string {
  throw new Error("Not implemented");
}

/** A page response with the security headers, `Content-Type: text/html; charset=utf-8`, `Content-Language` and one `Set-Cookie` per entry of `cookies`. */
export function htmlResponse(
  page: string,
  status: number,
  language: Language,
  cookies: readonly string[],
): Promise<Response> {
  throw new Error("Not implemented");
}

/** A response without a body with the security headers, `Location` when given and one `Set-Cookie` per entry of `cookies`. */
export function emptyResponse(status: number, cookies: readonly string[], location?: string): Promise<Response> {
  throw new Error("Not implemented");
}
