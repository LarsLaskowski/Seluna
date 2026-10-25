import type { AccountChoice } from "../github/manifest";
import type { Language } from "./language";
import type { TelegramChat } from "../telegram";
import type { GitHubStepView } from "./github-step";
import { RULE_IDS, timeZones } from "../settings";
import type { NotificationSettings } from "../settings";
import { RESET_PATH, SETTINGS_PATH } from "./settings-form";
import { formatDeliveryTime } from "./status";
import type { AppStatus, BotTokenStatus, ChatStatus, InstallationsView, StatusView } from "./status";
import type { Installation, InstallationAccount } from "../github/installations";
import { TELEGRAM_TOKEN_PATH, TELEGRAM_TOKEN_REMOVE_PATH } from "./telegram-step";
import type { ChatPart, TelegramStepView, TokenState } from "./telegram-step";
import { TEXTS } from "./texts";
import type { Notice } from "./texts";

const DEFAULT_QUIET_START = "22:00";
const DEFAULT_QUIET_END = "07:00";

/** The content of every page's single `<style>` element. */
export const STYLE =
  ":root{color-scheme:light dark;--bg:#f3f4f6;--fg:#1f2933;--card:#ffffff;--border:#7c8591;--control:#5f6b7a;" +
  "--link:#1a4bc4;--primary:#1a4bc4;--on-primary:#ffffff;--secondary:#ffffff;--on-secondary:#1f2933;" +
  "--danger:#b42318;--on-danger:#ffffff;--error-bg:#fdecea;--error-fg:#7a1c13;--error-border:#b42318;" +
  "--info-bg:#e6f0fb;--info-fg:#0f3563;--info-border:#2a62b0;--focus:#1a4bc4}" +
  "@media (prefers-color-scheme:dark){:root{--bg:#111827;--fg:#f3f4f6;--card:#1f2937;--border:#6b7686;" +
  "--control:#9ca3af;--link:#8ab4ff;--primary:#93c5fd;--on-primary:#0b1220;--secondary:#1f2937;" +
  "--on-secondary:#f3f4f6;--danger:#f87171;--on-danger:#1a0505;--error-bg:#3b1414;--error-fg:#fecaca;" +
  "--error-border:#f87171;--info-bg:#0f2a4a;--info-fg:#cfe3ff;--info-border:#60a5fa;--focus:#facc15}}" +
  'body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
  "line-height:1.5;overflow-wrap:anywhere}" +
  "a{color:var(--link)}" +
  "header.site{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:.25rem 1rem;" +
  "padding:.75rem 1rem;background:var(--card);border-bottom:1px solid var(--border)}" +
  ".brand{margin:0;font-size:1.1rem;font-weight:700}" +
  "nav{font-size:.9rem}" +
  "main{max-width:36rem;margin:0 auto;padding:1rem}" +
  "h1{font-size:1.6rem;line-height:1.25;margin:.5rem 0 1rem}" +
  "h2{font-size:1.25rem;line-height:1.3;margin:0 0 .75rem}" +
  ".card{background:var(--card);border:1px solid var(--border);border-radius:.5rem;padding:1rem;margin-bottom:1rem}" +
  ".card p:last-child,.card ul:last-child{margin-bottom:0}" +
  ".actions{margin-bottom:1rem}" +
  "label{display:block;margin:.5rem 0 .25rem}" +
  'input,select,button{box-sizing:border-box;max-width:100%;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:1rem}' +
  "input,select{display:block;width:100%;margin:.25rem 0 1rem;padding:.5rem;color:var(--fg);" +
  "background:var(--card);border:1px solid var(--control);border-radius:.375rem}" +
  "input[type=radio],input[type=checkbox]{display:inline;width:auto;margin:0 .5rem 0 0;padding:0;" +
  "accent-color:var(--primary)}" +
  "button{min-height:2.75rem;padding:.5rem 1rem;border:1px solid var(--control);border-radius:.375rem;" +
  "cursor:pointer;font-weight:600}" +
  ".primary{background:var(--primary);color:var(--on-primary);border-color:var(--primary)}" +
  ".secondary{background:var(--secondary);color:var(--on-secondary);border-color:var(--control)}" +
  ".danger{background:var(--danger);color:var(--on-danger);border-color:var(--danger)}" +
  ".group{border:1px solid var(--control);border-radius:.375rem;margin:0 0 1rem;padding:.5rem 1rem 1rem}" +
  "legend{padding:0 .5rem}" +
  ".notice{margin:0 0 1rem;padding:.5rem .75rem;border:1px solid var(--border);border-radius:.375rem}" +
  ".notice.error{background:var(--error-bg);color:var(--error-fg);border-color:var(--error-border);" +
  "border-inline-start-width:.375rem}" +
  ".notice.info{background:var(--info-bg);color:var(--info-fg);border-color:var(--info-border);" +
  "border-inline-start-width:.375rem}" +
  "a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--focus);" +
  "outline-offset:2px}" +
  ".steps [aria-current=page]{font-weight:700}";

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
    : `<p class="notice error" role="alert">${escapeHtml(TEXTS[language].notices[notice])}</p>`;
}

/** A card: one section of the main column. */
function card(content: string): string {
  return `<section class="card">\n${content}\n</section>`;
}

/** The page heading followed by one card holding `content`. */
function titled(heading: string, content: string): string {
  return `${heading}\n${card(content)}`;
}

function csrfInput(csrfToken: string): string {
  return `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">`;
}

/** The items of the step navigation, in their order. */
type NavigationItem = "start" | "telegram" | "github";

/** The step navigation with `current` as marked text and the other items as links. */
function stepNavigationHtml(language: Language, current: NavigationItem): string {
  const texts = TEXTS[language];
  const items: readonly { readonly item: NavigationItem; readonly path: string; readonly label: string }[] = [
    { item: "start", path: "/setup", label: texts.startPageLink },
    { item: "telegram", path: "/setup/telegram", label: texts.telegramHeading },
    { item: "github", path: "/setup/github", label: texts.githubHeading },
  ];
  const entries = items.map(({ item, path, label }) =>
    item === current
      ? `<span aria-current="page">${escapeHtml(label)}</span>`
      : `<a href="${path}">${escapeHtml(label)}</a>`,
  );
  return `<nav class="steps" aria-label="${escapeHtml(texts.stepsLabel)}">${entries.join(" | ")}</nav>\n`;
}

/** A complete page: the header (brand, the step navigation when `current` is given, the language navigation) and `body` as the main column. */
function layout(language: Language, body: string, current: NavigationItem | undefined): string {
  const texts = TEXTS[language];
  const steps = current === undefined ? "" : stepNavigationHtml(language, current);
  return (
    `<!DOCTYPE html>\n<html lang="${language}">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${escapeHtml(texts.pageTitle)}</title>\n<style>${STYLE}</style>\n</head>\n<body>\n` +
    `<header class="site">\n<p class="brand">${escapeHtml(texts.pageTitle)}</p>\n${steps}` +
    `<nav aria-label="${escapeHtml(texts.languageLabel)}">${escapeHtml(texts.languageLabel)}: <a href="/setup?lang=en">English</a> | <a href="/setup?lang=de">Deutsch</a></nav>\n</header>\n` +
    `<main>\n${body}\n</main>\n</body>\n</html>\n`
  );
}

/** Every page links to `/setup?lang=en` and `/setup?lang=de`, whatever path it is answered on; this page has no step navigation. */
export function renderLoginPage(language: Language, csrfToken: string, notice?: Notice): string {
  const texts = TEXTS[language];
  return layout(
    language,
    `<h1>${escapeHtml(texts.loginHeading)}</h1>\n<p>${escapeHtml(texts.loginIntro)}</p>\n${noticeHtml(language, notice)}\n` +
      card(
        `<form method="post" action="/setup/login">\n${csrfInput(csrfToken)}\n` +
          `<label for="secret">${escapeHtml(texts.secretLabel)}</label>\n` +
          `<input id="secret" type="password" name="secret" autocomplete="current-password" required>\n` +
          `<button type="submit" class="primary">${escapeHtml(texts.loginButton)}</button>\n</form>`,
      ),
    undefined,
  );
}

/** What the start page shows: the status and the settings, or only the notice, the step links and sign-out. */
export type StartPageView = { readonly kind: "status"; readonly status: StatusView } | { readonly kind: "notice-only" };

function stepLinksHtml(language: Language): string {
  const texts = TEXTS[language];
  return card(
    `<ul>\n<li><a href="/setup/telegram">${escapeHtml(texts.telegramHeading)}</a></li>\n` +
      `<li><a href="/setup/github">${escapeHtml(texts.githubHeading)}</a></li>\n</ul>`,
  );
}

function logoutFormHtml(language: Language, csrfToken: string): string {
  return (
    `<section class="actions">\n<form method="post" action="/setup/logout">\n${csrfInput(csrfToken)}\n` +
    `<button type="submit" class="secondary">${escapeHtml(TEXTS[language].logoutButton)}</button>\n</form>\n</section>`
  );
}

function botTokenStatusHtml(language: Language, botToken: BotTokenStatus): string {
  const texts = TEXTS[language];
  switch (botToken) {
    case "worker-secret":
      return escapeHtml(texts.botTokenSecret);
    case "saved":
      return escapeHtml(texts.botTokenSaved);
    case "none":
      return escapeHtml(texts.noneSavedYet);
    case "unreadable":
      return escapeHtml(texts.cannotBeRead);
    default: {
      const unreachable: never = botToken;
      return unreachable;
    }
  }
}

function chatStatusHtml(language: Language, chat: ChatStatus): string {
  const texts = TEXTS[language];
  switch (chat.kind) {
    case "secret":
      return escapeHtml(texts.chatSecret);
    case "saved":
      return `<code>${String(chat.chatId)}</code>`;
    case "none":
      return escapeHtml(texts.noneSavedYet);
    default: {
      const unreachable: never = chat;
      return unreachable;
    }
  }
}

function appStatusHtml(language: Language, app: AppStatus): string {
  const texts = TEXTS[language];
  switch (app.kind) {
    case "worker-secrets":
      return escapeHtml(texts.appSecrets);
    case "partial-worker-secrets":
      return escapeHtml(texts.appPartial);
    case "saved": {
      const appId = `${escapeHtml(texts.appIdLabel)} ${String(app.appId)}`;
      return app.slug === undefined
        ? appId
        : `<a href="https://github.com/apps/${escapeHtml(app.slug)}">${escapeHtml(app.slug)}</a> (${appId})`;
    }
    case "none":
      return escapeHtml(texts.noneSavedYet);
    case "unreadable":
      return escapeHtml(texts.cannotBeRead);
    default: {
      const unreachable: never = app;
      return unreachable;
    }
  }
}

function accountHtml(language: Language, account: InstallationAccount): string {
  const texts = TEXTS[language];
  switch (account.kind) {
    case "login": {
      let type: string;
      switch (account.type) {
        case "User":
          type = texts.accountPersonal;
          break;
        case "Organization":
          type = texts.accountOrganization;
          break;
        default:
          type = texts.accountOther;
      }
      return `${escapeHtml(account.login)} (${escapeHtml(type)})`;
    }
    case "enterprise":
      return `${escapeHtml(account.slug)} (${escapeHtml(texts.accountEnterprise)})`;
    case "unknown":
      return escapeHtml(texts.unknownAccount);
    default: {
      const unreachable: never = account;
      return unreachable;
    }
  }
}

function installationHtml(language: Language, installation: Installation): string {
  const texts = TEXTS[language];
  const selection = installation.repositorySelection === "all" ? texts.repositoriesAll : texts.repositoriesSelected;
  const suspended = installation.suspended ? `, ${escapeHtml(texts.installationSuspended)}` : "";
  return `<li>${accountHtml(language, installation.account)}, ${escapeHtml(selection)}${suspended}</li>`;
}

/** The _Installations:_ part of the status section, each line ending in a line break; empty when hidden. */
function installationsHtml(language: Language, installations: InstallationsView): string {
  const texts = TEXTS[language];
  const label = escapeHtml(texts.installationsLabel);
  switch (installations.kind) {
    case "hidden":
      return "";
    case "unavailable":
      return `<p>${label} ${escapeHtml(texts.installationsUnavailable)}</p>\n`;
    case "key-unusable":
      return `<p>${label} ${escapeHtml(texts.keyUnusable)}</p>\n`;
    case "listed": {
      if (installations.installations.length === 0) {
        return `<p>${label} ${escapeHtml(texts.notInstalled)}</p>\n`;
      }
      const entries = installations.installations.map((installation) => installationHtml(language, installation));
      const more = installations.more ? `\n<p>${escapeHtml(texts.moreInstallations)}</p>` : "";
      return `<p>${label}</p>\n<ul>\n${entries.join("\n")}\n</ul>${more}\n`;
    }
    default: {
      const unreachable: never = installations;
      return unreachable;
    }
  }
}

function statusHtml(language: Language, status: StatusView): string {
  const texts = TEXTS[language];
  const delivery =
    status.lastDelivery === undefined
      ? escapeHtml(texts.noneReceivedYet)
      : escapeHtml(formatDeliveryTime(status.lastDelivery, status.settings.timeZone));
  return card(
    `<h2>${escapeHtml(texts.statusHeading)}</h2>\n` +
      `<p>${escapeHtml(texts.versionLabel)} <code>${escapeHtml(status.version)}</code></p>\n` +
      `<p>${escapeHtml(texts.botTokenLabel)} ${botTokenStatusHtml(language, status.botToken)}</p>\n` +
      `<p>${escapeHtml(texts.telegramChatLabel)} ${chatStatusHtml(language, status.chat)}</p>\n` +
      `<p>${escapeHtml(texts.githubAppLabel)} ${appStatusHtml(language, status.app)}</p>\n` +
      installationsHtml(language, status.installations) +
      `<p>${escapeHtml(texts.lastDeliveryLabel)} ${delivery}</p>`,
  );
}

function resetHtml(language: Language, csrfToken: string): string {
  const texts = TEXTS[language];
  return card(
    `<h2>${escapeHtml(texts.resetHeading)}</h2>\n<p>${escapeHtml(texts.resetText)}</p>\n` +
      `<form method="post" action="${RESET_PATH}">\n${csrfInput(csrfToken)}\n` +
      `<button type="submit" class="danger">${escapeHtml(texts.resetButton)}</button>\n</form>`,
  );
}

function optionHtml(value: string, label: string, selected: boolean): string {
  return `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
}

function checkboxHtml(name: string, label: string, checked: boolean): string {
  return `<label><input type="checkbox" name="${name}" value="on"${checked ? " checked" : ""}> ${escapeHtml(label)}</label>`;
}

function settingsFormHtml(language: Language, csrfToken: string, settings: NotificationSettings): string {
  const texts = TEXTS[language];
  const { quietHours } = settings;
  const zones = timeZones().map((zone) => optionHtml(zone, zone, zone === settings.timeZone));
  const rules = RULE_IDS.map((id) => checkboxHtml(`rule_${id}`, texts.ruleLabels[id], settings.rules[id]));
  return card(
    `<h2>${escapeHtml(texts.settingsHeading)}</h2>\n<form method="post" action="${SETTINGS_PATH}">\n${csrfInput(csrfToken)}\n` +
      `<label for="notification_language">${escapeHtml(texts.notificationLanguageLabel)}</label>\n` +
      `<select id="notification_language" name="notification_language">\n` +
      `${optionHtml("en", "English", settings.language === "en")}\n${optionHtml("de", "Deutsch", settings.language === "de")}\n</select>\n` +
      `<label for="time_zone">${escapeHtml(texts.timeZoneLabel)}</label>\n` +
      `<select id="time_zone" name="time_zone">\n${zones.join("\n")}\n</select>\n` +
      `<fieldset class="group">\n<legend>${checkboxHtml("quiet_hours", texts.quietHoursLabel, quietHours !== undefined)}</legend>\n` +
      `<label for="quiet_start">${escapeHtml(texts.quietStartLabel)}</label>\n` +
      `<input id="quiet_start" type="time" name="quiet_start" value="${quietHours?.start ?? DEFAULT_QUIET_START}">\n` +
      `<label for="quiet_end">${escapeHtml(texts.quietEndLabel)}</label>\n` +
      `<input id="quiet_end" type="time" name="quiet_end" value="${quietHours?.end ?? DEFAULT_QUIET_END}">\n</fieldset>\n` +
      `<fieldset class="group">\n<legend>${escapeHtml(texts.rulesLabel)}</legend>\n${rules.join("\n")}\n` +
      `${checkboxHtml("update_notice", texts.updateNoticeLabel, settings.updateNotice)}\n</fieldset>\n` +
      `<button type="submit" class="primary">${escapeHtml(texts.saveSettingsButton)}</button>\n</form>`,
  );
}

/** The start page of the signed-in owner: status, reset when needed, step links, settings form and sign-out. */
export function renderStartPage(language: Language, csrfToken: string, view: StartPageView, notice?: Notice): string {
  const texts = TEXTS[language];
  const head = `<h1>${escapeHtml(texts.startHeading)}</h1>\n<p>${escapeHtml(texts.startBody)}</p>\n${noticeHtml(language, notice)}`;
  switch (view.kind) {
    case "notice-only":
      return layout(language, `${head}\n${stepLinksHtml(language)}\n${logoutFormHtml(language, csrfToken)}`, "start");
    case "status": {
      const sections = [
        head,
        statusHtml(language, view.status),
        ...(view.status.resetNeeded ? [resetHtml(language, csrfToken)] : []),
        stepLinksHtml(language),
        settingsFormHtml(language, csrfToken, view.status.settings),
        logoutFormHtml(language, csrfToken),
      ];
      return layout(language, sections.join("\n"), "start");
    }
    default: {
      const unreachable: never = view;
      return unreachable;
    }
  }
}

/** The page that explains how to set `SELUNA_SECRET`; like the login page, it has no step navigation. */
export function renderNotConfiguredPage(language: Language): string {
  const texts = TEXTS[language];
  const paragraphs = texts.notConfiguredParagraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n");
  return layout(language, `<h1>${escapeHtml(texts.notConfiguredHeading)}</h1>\n${card(paragraphs)}`, undefined);
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
    `<button type="submit" class="primary">${escapeHtml(texts.telegramConfirmButton)}</button>\n</form>`
  );
}

/** The token form: a masked field the browser does not fill, never with a value. */
function tokenFormHtml(language: Language, csrfToken: string): string {
  const texts = TEXTS[language];
  return (
    `<form method="post" action="${TELEGRAM_TOKEN_PATH}">\n${csrfInput(csrfToken)}\n` +
    `<label for="token">${escapeHtml(texts.telegramTokenLabel)}</label>\n` +
    `<input id="token" type="password" name="token" autocomplete="off" spellcheck="false" maxlength="221" required>\n` +
    `<button type="submit" class="primary">${escapeHtml(texts.telegramTokenSaveButton)}</button>\n</form>`
  );
}

function removeTokenFormHtml(language: Language, csrfToken: string): string {
  return (
    `<form method="post" action="${TELEGRAM_TOKEN_REMOVE_PATH}">\n${csrfInput(csrfToken)}\n` +
    `<button type="submit" class="secondary">${escapeHtml(TEXTS[language].telegramTokenRemoveButton)}</button>\n</form>`
  );
}

/** The content of the token card after its heading; `notice` replaces the notice the state implies. */
function tokenCardHtml(language: Language, csrfToken: string, token: TokenState, notice: Notice | undefined): string {
  const texts = TEXTS[language];
  const parts: string[] = [`<h2>${escapeHtml(texts.telegramTokenHeading)}</h2>`];
  switch (token.kind) {
    case "missing":
      parts.push(
        noticeHtml(language, notice),
        `<p>${escapeHtml(texts.telegramTokenIntro)}</p>`,
        tokenFormHtml(language, csrfToken),
      );
      break;
    case "entry":
      parts.push(noticeHtml(language, notice), tokenFormHtml(language, csrfToken));
      break;
    case "saved":
      parts.push(
        noticeHtml(language, notice ?? (token.rejected ? "telegram-saved-token-rejected" : undefined)),
        `<p>${escapeHtml(texts.telegramTokenSaved)}</p>`,
        `<details${token.rejected ? " open" : ""}>\n<summary>${escapeHtml(texts.telegramTokenChange)}</summary>\n` +
          `${tokenFormHtml(language, csrfToken)}\n</details>`,
        removeTokenFormHtml(language, csrfToken),
      );
      break;
    case "damaged":
      parts.push(
        noticeHtml(language, notice ?? "telegram-token-damaged"),
        tokenFormHtml(language, csrfToken),
        removeTokenFormHtml(language, csrfToken),
      );
      break;
    case "unreadable":
      parts.push(noticeHtml(language, notice ?? "telegram-token-unreadable"));
      break;
    case "worker-secret":
      parts.push(
        noticeHtml(language, notice ?? (token.rejected ? "telegram-token-rejected" : undefined)),
        `<p class="notice info">${escapeHtml(texts.telegramTokenWorkerSecret)}</p>`,
      );
      break;
    case "worker-secret-malformed":
      parts.push(noticeHtml(language, notice ?? "telegram-token-malformed"));
      break;
    default: {
      const unreachable: never = token;
      return unreachable;
    }
  }
  return parts.filter((part) => part !== "").join("\n");
}

const CHAT_PROBLEM_NOTICES = {
  conflict: "telegram-conflict",
  unavailable: "telegram-unavailable",
} as const satisfies Readonly<Record<string, Notice>>;

/** The chat card, or an empty text for an omitted chat part. */
function chatCardHtml(language: Language, csrfToken: string, chat: ChatPart): string {
  const texts = TEXTS[language];
  const heading = `<h2>${escapeHtml(texts.telegramChatHeading)}</h2>`;
  const intro = `<p>${escapeHtml(texts.telegramIntro)}</p>`;
  switch (chat.kind) {
    case "omitted":
      return "";
    case "chat-id-secret":
      return card(`${heading}\n<p class="notice info">${escapeHtml(texts.telegramChatIdSecret)}</p>`);
    case "hidden":
      return card(`${heading}\n${intro}\n${savedChatHtml(language, chat.savedChatId)}`);
    case "problem":
      return card(
        `${heading}\n${intro}\n${noticeHtml(language, CHAT_PROBLEM_NOTICES[chat.problem])}\n` +
          `${savedChatHtml(language, chat.savedChatId)}\n${searchLink(language)}`,
      );
    case "chats":
      return card(
        `${heading}\n${intro}\n${savedChatHtml(language, chat.savedChatId)}\n` +
          `${searchLink(language)}\n${chatsHtml(language, csrfToken, chat.chats)}`,
      );
    default: {
      const unreachable: never = chat;
      return unreachable;
    }
  }
}

function codeHtml(language: Language, csrfToken: string, chatId: number, proof: string): string {
  const texts = TEXTS[language];
  return (
    `<p>${escapeHtml(texts.telegramCodeSent)} <code>${String(chatId)}</code></p>\n<p>${escapeHtml(texts.telegramCodeIntro)}</p>\n` +
    `<form method="post" action="/setup/telegram/verify">\n${csrfInput(csrfToken)}\n` +
    `<input type="hidden" name="proof" value="${escapeHtml(proof)}">\n` +
    `<label for="code">${escapeHtml(texts.telegramCodeLabel)}</label>\n` +
    `<input id="code" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>\n` +
    `<button type="submit" class="primary">${escapeHtml(texts.telegramCodeButton)}</button>\n</form>`
  );
}

/** The Telegram step page; with the step navigation. A `problem` view shows the notice of its problem. */
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
    case "step": {
      const chatCard = chatCardHtml(language, csrfToken, view.chat);
      body =
        `${heading}\n${card(tokenCardHtml(language, csrfToken, view.token, notice))}` +
        (chatCard === "" ? "" : `\n${chatCard}`);
      break;
    }
    case "notice-only":
      body = titled(heading, `${intro}\n${noticeHtml(language, notice)}\n${searchLink(language)}`);
      break;
    case "code":
      body = titled(
        heading,
        `${noticeHtml(language, notice)}\n${codeHtml(language, csrfToken, view.chatId, view.proof)}\n${searchLink(language)}`,
      );
      break;
    default: {
      const unreachable: never = view;
      return unreachable;
    }
  }
  return layout(language, body, "telegram");
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
    `<button type="submit" class="primary">${escapeHtml(texts.githubNextButton)}</button>\n</form>`
  );
}

function githubCreatedHtml(language: Language, slug: string | undefined): string {
  const texts = TEXTS[language];
  const install =
    slug === undefined
      ? `<p>${escapeHtml(texts.githubInstallManual)}</p>`
      : `<p>${escapeHtml(texts.githubInstallIntro)}</p>\n` +
        `<p><a href="https://github.com/apps/${escapeHtml(slug)}/installations/new">${escapeHtml(texts.githubInstallLink)}</a></p>`;
  return `<p class="notice info">${escapeHtml(texts.githubCreated)}</p>\n${install}`;
}

/** The GitHub App step page; with the step navigation. */
export function renderGitHubPage(language: Language, csrfToken: string, view: GitHubPageView, notice?: Notice): string {
  const texts = TEXTS[language];
  const heading = `<h1>${escapeHtml(texts.githubHeading)}</h1>`;
  const intro = `<p>${escapeHtml(texts.githubIntro)}</p>`;
  let body: string;
  switch (view.kind) {
    case "worker-secrets":
      body = titled(heading, `<p class="notice info">${escapeHtml(texts.githubWorkerSecrets)}</p>`);
      break;
    case "partial-worker-secrets":
      body = titled(heading, `<p class="notice error">${escapeHtml(texts.githubPartialWorkerSecrets)}</p>`);
      break;
    case "reset-needed":
      body = titled(heading, `<p class="notice error">${escapeHtml(texts.githubResetNeeded)}</p>`);
      break;
    case "notice-only":
      body = titled(heading, `${noticeHtml(language, notice)}\n${githubBackLink(language)}`);
      break;
    case "created":
      body = titled(heading, githubCreatedHtml(language, view.slug));
      break;
    case "form":
      body =
        `${heading}\n` +
        card(
          `${intro}\n${noticeHtml(language, notice)}\n${savedAppHtml(language, view.savedAppId)}\n` +
            githubFormHtml(language, csrfToken),
        );
      break;
    default: {
      const unreachable: never = view;
      return unreachable;
    }
  }
  return layout(language, body, "github");
}

/** The review page whose form posts the manifest to GitHub; with the step navigation. */
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
    `<h1>${escapeHtml(texts.githubHeading)}</h1>\n` +
      card(
        `<p>${escapeHtml(texts.githubReviewIntro)}</p>\n` +
          `<p>${escapeHtml(texts.githubReviewAccountLabel)} <bdi>${escapeHtml(choice.account)}</bdi> (${escapeHtml(type)})</p>\n` +
          `<p>${escapeHtml(texts.githubAppNameLabel)} <code>${escapeHtml(appName)}</code></p>\n` +
          `<p>${escapeHtml(texts.githubPermissionsLabel)} ${escapeHtml(texts.githubPermissionsList)}</p>\n` +
          `<p>${escapeHtml(texts.githubEventsLabel)} ${escapeHtml(texts.githubEventsList)}</p>\n` +
          `<form method="post" action="${escapeHtml(formAction)}">\n` +
          `<input type="hidden" name="manifest" value="${escapeHtml(manifest)}">\n` +
          `<button type="submit" class="primary">${escapeHtml(texts.githubToGitHubButton)}</button>\n</form>`,
      ),
    "github",
  );
}

/** The finish page whose form posts the return's `code` and `state` back; with the step navigation. */
export function renderGitHubFinishPage(language: Language, code: string, state: string, notice?: Notice): string {
  const texts = TEXTS[language];
  return layout(
    language,
    `<h1>${escapeHtml(texts.githubHeading)}</h1>\n` +
      card(
        `<p>${escapeHtml(texts.githubFinishIntro)}</p>\n${noticeHtml(language, notice)}\n` +
          `<form method="post" action="/setup/github/callback">\n` +
          `<input type="hidden" name="code" value="${escapeHtml(code)}">\n` +
          `<input type="hidden" name="state" value="${escapeHtml(state)}">\n` +
          `<button type="submit" class="primary">${escapeHtml(texts.githubFinishButton)}</button>\n</form>`,
      ),
    "github",
  );
}
