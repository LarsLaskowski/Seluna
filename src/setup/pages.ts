import type { AccountChoice } from "../github/manifest";
import type { Language } from "./language";
import type { TelegramChat } from "../telegram";
import type { GitHubStepView } from "./github-step";
import type { TelegramProblem, TelegramStepView } from "./telegram-step";
import { TEXTS } from "./texts";
import type { Notice } from "./texts";

/** The content of every page's single `<style>` element. */
export const STYLE =
  "body{font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;line-height:1.5}" +
  "label,input{display:block;width:100%;box-sizing:border-box}input{margin:.25rem 0 1rem;padding:.5rem}" +
  "input[type=radio]{display:inline;width:auto;margin:0 .5rem 0 0}" +
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

/** Where a page's forms may post to: this origin, or (the manifest review page) `https://github.com`. */
export type FormTarget = "self" | "github";

/** `default-src 'none'; style-src 'sha256-<base64 SHA-256 of STYLE>'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`; `form-action https://github.com` for the `github` target. */
export async function contentSecurityPolicy(formTarget: FormTarget = "self"): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(STYLE)));
  // The policy wants standard base64 with padding, not base64url.
  const hash = btoa(Array.from(digest, (byte) => String.fromCodePoint(byte)).join(""));
  return `default-src 'none'; style-src 'sha256-${hash}'; form-action ${formTarget === "github" ? "https://github.com" : "'self'"}; frame-ancestors 'none'; base-uri 'none'`;
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
      `<ul>\n<li><a href="/setup/telegram">${escapeHtml(texts.telegramHeading)}</a></li>\n</ul>\n` +
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

async function securityHeaders(formTarget: FormTarget = "self"): Promise<Headers> {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("Content-Security-Policy", await contentSecurityPolicy(formTarget));
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
  formTarget: FormTarget = "self",
): Promise<Response> {
  const headers = await securityHeaders(formTarget);
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

export type TelegramPageView =
  | TelegramStepView
  | { readonly kind: "notice-only" }
  | { readonly kind: "code"; readonly chatId: number; readonly proof: string };

const PROBLEM_NOTICES: Readonly<Record<TelegramProblem, Notice>> = {
  "token-missing": "telegram-token-missing",
  "token-malformed": "telegram-token-malformed",
  "token-rejected": "telegram-token-rejected",
  conflict: "telegram-conflict",
  unavailable: "telegram-unavailable",
};

function searchLink(language: Language): string {
  return `<p><a href="/setup/telegram">${escapeHtml(TEXTS[language].telegramSearchLink)}</a></p>`;
}

function savedChatHtml(language: Language, savedChatId: number | undefined): string {
  const texts = TEXTS[language];
  return savedChatId === undefined
    ? `<p>${escapeHtml(texts.telegramNoSavedChat)}</p>`
    : `<p>${escapeHtml(texts.telegramSavedChat)} <code>${String(savedChatId)}</code></p>`;
}

/** One radio input per chat; every name is escaped and isolated in its own `bdi`, the username in another one after it. */
function chatOptionHtml(language: Language, chat: TelegramChat): string {
  const texts = TEXTS[language];
  const username = chat.username === undefined ? "" : ` <bdi class="username">@${escapeHtml(chat.username)}</bdi>`;
  const kind = chat.kind === "private" ? texts.telegramPrivateChat : texts.telegramGroup;
  return (
    `<label><input type="radio" name="chat" value="${String(chat.id)}" required> ` +
    `<bdi>${escapeHtml(chat.name)}</bdi>${username} (${escapeHtml(kind)})</label>`
  );
}

function chatsHtml(language: Language, csrfToken: string, chats: readonly TelegramChat[]): string {
  const texts = TEXTS[language];
  if (chats.length === 0) {
    return `<p>${escapeHtml(texts.telegramNoChats)}</p>`;
  }
  return (
    `<p>${escapeHtml(texts.telegramChatsIntro)}</p>\n<form method="post" action="/setup/telegram">\n${csrfInput(csrfToken)}\n` +
    `${chats.map((chat) => chatOptionHtml(language, chat)).join("\n")}\n` +
    `<button type="submit">${escapeHtml(texts.telegramConfirmButton)}</button>\n</form>`
  );
}

function codeHtml(language: Language, csrfToken: string, chatId: number, proof: string): string {
  const texts = TEXTS[language];
  return (
    `<p>${escapeHtml(texts.telegramCodeSent)} <code>${String(chatId)}</code></p>\n<p>${escapeHtml(texts.telegramCodeIntro)}</p>\n` +
    `<form method="post" action="/setup/telegram/verify">\n${csrfInput(csrfToken)}\n` +
    `<input type="hidden" name="proof" value="${escapeHtml(proof)}">\n` +
    `<label for="code">${escapeHtml(texts.telegramCodeLabel)}</label>\n` +
    `<input id="code" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>\n` +
    `<button type="submit">${escapeHtml(texts.telegramCodeButton)}</button>\n</form>`
  );
}

/** The Telegram step page; links like the login page. A `problem` view shows the notice of its problem. */
export function renderTelegramPage(
  language: Language,
  csrfToken: string,
  view: TelegramPageView,
  notice?: Notice,
): string {
  const texts = TEXTS[language];
  const heading = `<h1>${escapeHtml(texts.telegramHeading)}</h1>`;
  const intro = `<p>${escapeHtml(texts.telegramIntro)}</p>`;
  let body: string;
  switch (view.kind) {
    case "chat-id-secret":
      body = `${heading}\n<p>${escapeHtml(texts.telegramChatIdSecret)}</p>`;
      break;
    case "notice-only":
      body = `${heading}\n${intro}\n${noticeHtml(language, notice)}\n${searchLink(language)}`;
      break;
    case "code":
      body = `${heading}\n${noticeHtml(language, notice)}\n${codeHtml(language, csrfToken, view.chatId, view.proof)}\n${searchLink(language)}`;
      break;
    case "problem":
      body =
        `${heading}\n${intro}\n${noticeHtml(language, notice ?? PROBLEM_NOTICES[view.problem])}\n` +
        `${savedChatHtml(language, view.savedChatId)}\n${searchLink(language)}`;
      break;
    case "chats":
      body =
        `${heading}\n${intro}\n${noticeHtml(language, notice)}\n${savedChatHtml(language, view.savedChatId)}\n` +
        `${searchLink(language)}\n${chatsHtml(language, csrfToken, view.chats)}`;
      break;
    default: {
      const unreachable: never = view;
      return unreachable;
    }
  }
  return layout(language, body);
}

export type GitHubPageView =
  GitHubStepView | { readonly kind: "notice-only" } | { readonly kind: "created"; readonly slug: string | undefined };

/** The GitHub App step page; links like the login page. */
export function renderGitHubPage(
  _language: Language,
  _csrfToken: string,
  _view: GitHubPageView,
  _notice?: Notice,
): string {
  throw new Error("Not implemented");
}

/** The review page whose form posts the manifest to GitHub; links like the login page. */
export function renderGitHubReviewPage(
  _language: Language,
  _choice: AccountChoice,
  _appName: string,
  _formAction: string,
  _manifest: string,
): string {
  throw new Error("Not implemented");
}

/** The finish page whose form posts the return's `code` and `state` back; links like the login page. */
export function renderGitHubFinishPage(_language: Language, _code: string, _state: string, _notice?: Notice): string {
  throw new Error("Not implemented");
}
