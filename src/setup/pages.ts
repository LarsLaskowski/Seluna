import type { Language } from "./language";
import { TEXTS } from "./texts";
import type { Notice } from "./texts";

/** The content of every page's single `<style>` element. */
export const STYLE =
  "body{font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;line-height:1.5}" +
  "label,input{display:block;width:100%;box-sizing:border-box}input{margin:.25rem 0 1rem;padding:.5rem}" +
  "button{padding:.5rem 1rem}.notice{padding:.5rem;border:1px solid currentcolor}nav{font-size:.9rem}";

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

const ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** `text` with `&`, `<`, `>`, `"` and `'` replaced by character references. */
export function escapeHtml(text: string): string {
  return text.replaceAll(/[&<>"']/g, (character) => ENTITIES[character] ?? character);
}

/** `default-src 'none'; style-src 'sha256-<base64 SHA-256 of STYLE>'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`. */
export async function contentSecurityPolicy(): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(STYLE)));
  // The policy wants standard base64 with padding, not base64url.
  const hash = btoa(Array.from(digest, (byte) => String.fromCodePoint(byte)).join(""));
  return `default-src 'none'; style-src 'sha256-${hash}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;
}

function noticeHtml(language: Language, notice: Notice | undefined): string {
  return notice === undefined
    ? ""
    : `<p class="notice" role="alert">${escapeHtml(TEXTS[language].notices[notice])}</p>`;
}

function csrfInput(csrfToken: string): string {
  return `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">`;
}

function layout(language: Language, body: string): string {
  const texts = TEXTS[language];
  return (
    `<!DOCTYPE html>\n<html lang="${language}">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${escapeHtml(texts.pageTitle)}</title>\n<style>${STYLE}</style>\n</head>\n<body>\n` +
    `<nav>${escapeHtml(texts.languageLabel)}: <a href="/setup?lang=en">English</a> | <a href="/setup?lang=de">Deutsch</a></nav>\n` +
    `${body}\n</body>\n</html>\n`
  );
}

/** Each page links to exactly `/setup?lang=en` and `/setup?lang=de`, whatever path it is answered on. */
export function renderLoginPage(language: Language, csrfToken: string, notice?: Notice): string {
  const texts = TEXTS[language];
  return layout(
    language,
    `<h1>${escapeHtml(texts.loginHeading)}</h1>\n<p>${escapeHtml(texts.loginIntro)}</p>\n${noticeHtml(language, notice)}\n` +
      `<form method="post" action="/setup/login">\n${csrfInput(csrfToken)}\n` +
      `<label for="secret">${escapeHtml(texts.secretLabel)}</label>\n` +
      `<input id="secret" type="password" name="secret" autocomplete="current-password" required>\n` +
      `<button type="submit">${escapeHtml(texts.loginButton)}</button>\n</form>`,
  );
}

/** The start page of the signed-in owner; links like the login page. */
export function renderStartPage(language: Language, csrfToken: string, notice?: Notice): string {
  const texts = TEXTS[language];
  return layout(
    language,
    `<h1>${escapeHtml(texts.startHeading)}</h1>\n<p>${escapeHtml(texts.startBody)}</p>\n${noticeHtml(language, notice)}\n` +
      `<form method="post" action="/setup/logout">\n${csrfInput(csrfToken)}\n` +
      `<button type="submit">${escapeHtml(texts.logoutButton)}</button>\n</form>`,
  );
}

/** The page that explains how to set `SELUNA_SECRET`; links like the login page. */
export function renderNotConfiguredPage(language: Language): string {
  const texts = TEXTS[language];
  const paragraphs = texts.notConfiguredParagraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n");
  return layout(language, `<h1>${escapeHtml(texts.notConfiguredHeading)}</h1>\n${paragraphs}`);
}

async function securityHeaders(): Promise<Headers> {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("Content-Security-Policy", await contentSecurityPolicy());
  return headers;
}

function addCookies(headers: Headers, cookies: readonly string[]): void {
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
}

/** A page response with the security headers, `Content-Type: text/html; charset=utf-8`, `Content-Language` and one `Set-Cookie` per entry of `cookies`. */
export async function htmlResponse(
  page: string,
  status: number,
  language: Language,
  cookies: readonly string[],
): Promise<Response> {
  const headers = await securityHeaders();
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Content-Language", language);
  addCookies(headers, cookies);
  return new Response(page, { status, headers });
}

/** A response without a body with the security headers, `Location` when given and one `Set-Cookie` per entry of `cookies`. */
export async function emptyResponse(status: number, cookies: readonly string[], location?: string): Promise<Response> {
  const headers = await securityHeaders();
  if (location !== undefined) {
    headers.set("Location", location);
  }
  addCookies(headers, cookies);
  return new Response(null, { status, headers });
}
