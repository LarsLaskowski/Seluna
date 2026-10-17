import type { AccountChoice } from "../github/manifest";
import type { Language } from "./language";
import type { TelegramChat } from "../telegram";
import type { GitHubStepView } from "./github-step";
import type { StatusView } from "./status";
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

/** What the start page shows: the status and the settings, or only the notice, the step links and sign-out. */
export type StartPageView = { readonly kind: "status"; readonly status: StatusView } | { readonly kind: "notice-only" };

/** The start page of the signed-in owner: status, reset when needed, step links, settings form and sign-out. */
export function renderStartPage(language: Language, csrfToken: string, view: StartPageView, notice?: Notice): string {
  throw new Error("Not implemented");
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

function githubBackLink(language: Language): string {
  return `<p><a href="/setup/github">${escapeHtml(TEXTS[language].githubBackLink)}</a></p>`;
}

function savedAppHtml(language: Language, savedAppId: number | undefined): string {
  const texts = TEXTS[language];
  return savedAppId === undefined
    ? `<p>${escapeHtml(texts.githubNoSavedApp)}</p>`
    : `<p>${escapeHtml(texts.githubSavedApp)} <code>${String(savedAppId)}</code></p>\n<p>${escapeHtml(texts.githubReplaceHint)}</p>`;
}

function githubFormHtml(language: Language, csrfToken: string): string {
  const texts = TEXTS[language];
  return (
    `<form method="post" action="/setup/github">\n${csrfInput(csrfToken)}\n` +
    `<label><input type="radio" name="account_type" value="personal" required> ${escapeHtml(texts.githubPersonal)}</label>\n` +
    `<label><input type="radio" name="account_type" value="organization" required> ${escapeHtml(texts.githubOrganization)}</label>\n` +
    `<label for="account">${escapeHtml(texts.githubAccountLabel)}</label>\n` +
    `<input id="account" type="text" name="account" maxlength="39" autocomplete="off" required>\n` +
    `<button type="submit">${escapeHtml(texts.githubNextButton)}</button>\n</form>`
  );
}

function githubCreatedHtml(language: Language, slug: string | undefined): string {
  const texts = TEXTS[language];
  const install =
    slug === undefined
      ? `<p>${escapeHtml(texts.githubInstallManual)}</p>`
      : `<p>${escapeHtml(texts.githubInstallIntro)}</p>\n` +
        `<p><a href="https://github.com/apps/${escapeHtml(slug)}/installations/new">${escapeHtml(texts.githubInstallLink)}</a></p>`;
  return `<p>${escapeHtml(texts.githubCreated)}</p>\n${install}`;
}

/** The GitHub App step page; links like the login page. */
export function renderGitHubPage(language: Language, csrfToken: string, view: GitHubPageView, notice?: Notice): string {
  const texts = TEXTS[language];
  const heading = `<h1>${escapeHtml(texts.githubHeading)}</h1>`;
  const intro = `<p>${escapeHtml(texts.githubIntro)}</p>`;
  let body: string;
  switch (view.kind) {
    case "worker-secrets":
      body = `${heading}\n<p>${escapeHtml(texts.githubWorkerSecrets)}</p>`;
      break;
    case "partial-worker-secrets":
      body = `${heading}\n<p>${escapeHtml(texts.githubPartialWorkerSecrets)}</p>`;
      break;
    case "reset-needed":
      body = `${heading}\n<p>${escapeHtml(texts.githubResetNeeded)}</p>`;
      break;
    case "notice-only":
      body = `${heading}\n${noticeHtml(language, notice)}\n${githubBackLink(language)}`;
      break;
    case "created":
      body = `${heading}\n${githubCreatedHtml(language, view.slug)}`;
      break;
    case "form":
      body =
        `${heading}\n${intro}\n${noticeHtml(language, notice)}\n${savedAppHtml(language, view.savedAppId)}\n` +
        githubFormHtml(language, csrfToken);
      break;
    default: {
      const unreachable: never = view;
      return unreachable;
    }
  }
  return layout(language, body);
}

/** The review page whose form posts the manifest to GitHub; links like the login page. */
export function renderGitHubReviewPage(
  language: Language,
  choice: AccountChoice,
  appName: string,
  formAction: string,
  manifest: string,
): string {
  const texts = TEXTS[language];
  const type = choice.type === "personal" ? texts.githubPersonal : texts.githubOrganization;
  return layout(
    language,
    `<h1>${escapeHtml(texts.githubHeading)}</h1>\n<p>${escapeHtml(texts.githubReviewIntro)}</p>\n` +
      `<p>${escapeHtml(texts.githubReviewAccountLabel)} <bdi>${escapeHtml(choice.account)}</bdi> (${escapeHtml(type)})</p>\n` +
      `<p>${escapeHtml(texts.githubAppNameLabel)} <code>${escapeHtml(appName)}</code></p>\n` +
      `<p>${escapeHtml(texts.githubPermissionsLabel)} ${escapeHtml(texts.githubPermissionsList)}</p>\n` +
      `<p>${escapeHtml(texts.githubEventsLabel)} ${escapeHtml(texts.githubEventsList)}</p>\n` +
      `<form method="post" action="${escapeHtml(formAction)}">\n` +
      `<input type="hidden" name="manifest" value="${escapeHtml(manifest)}">\n` +
      `<button type="submit">${escapeHtml(texts.githubToGitHubButton)}</button>\n</form>`,
  );
}

/** The finish page whose form posts the return's `code` and `state` back; links like the login page. */
export function renderGitHubFinishPage(language: Language, code: string, state: string, notice?: Notice): string {
  const texts = TEXTS[language];
  return layout(
    language,
    `<h1>${escapeHtml(texts.githubHeading)}</h1>\n<p>${escapeHtml(texts.githubFinishIntro)}</p>\n${noticeHtml(language, notice)}\n` +
      `<form method="post" action="/setup/github/callback">\n` +
      `<input type="hidden" name="code" value="${escapeHtml(code)}">\n` +
      `<input type="hidden" name="state" value="${escapeHtml(state)}">\n` +
      `<button type="submit">${escapeHtml(texts.githubFinishButton)}</button>\n</form>`,
  );
}
