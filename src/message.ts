import type { StoredNotification } from "./notification";
import type { Notification } from "./rules/rule";

/** Longest title, in code points. */
export const MAX_TITLE_CHARACTERS = 64;
/** Longest repository name, in code points. */
export const MAX_REPOSITORY_CHARACTERS = 140;
/** Longest line 2 or line 3, in code points. */
export const MAX_LINE_CHARACTERS = 256;
/** Longest normalized button URL, in characters. */
export const MAX_BUTTON_URL_LENGTH = 2048;

export interface OutboxMessage {
  /** Telegram HTML (`parse_mode` `HTML`). */
  readonly text: string;
  readonly buttonUrl: string | undefined;
}

/** Replaces `&`, `<` and `>` (in this order) so Telegram's HTML parser shows them literally. */
export function escapeTelegramHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Whether `codePoint` is a control character or a line or paragraph separator. */
function isSeparatorOrControl(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || codePoint === 0x2028 || codePoint === 0x2029;
}

/** Whether `codePoint` is a directional formatting or mark character (U+061C, U+200E, U+200F, U+202A-U+202E, U+2066-U+2069). */
function isDirectional(codePoint: number): boolean {
  return (
    codePoint === 0x061c ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

/** `text` cleaned (control and directional characters, lone surrogates) and cut to `maxCharacters` code points; not escaped. */
export function cleanField(text: string, maxCharacters: number): string {
  let cleaned = "";
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      // Iteration yields a lone surrogate as its own element; a well-formed pair is one astral code point.
      cleaned += "\uFFFD";
    } else if (isSeparatorOrControl(codePoint)) {
      cleaned += " ";
    } else if (!isDirectional(codePoint)) {
      cleaned += character;
    }
  }
  const characters = Array.from(cleaned.trim());
  return characters.length > maxCharacters
    ? `${characters.slice(0, maxCharacters - 1).join("")}…`
    : characters.join("");
}

/** The normalized `href` when `url` is an `https://github.com` URL within the length limit, otherwise `undefined`. */
export function buttonUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const allowed =
    parsed.protocol === "https:" && parsed.host === "github.com" && parsed.username === "" && parsed.password === "";
  return allowed && parsed.href.length <= MAX_BUTTON_URL_LENGTH ? parsed.href : undefined;
}

/** The Telegram HTML text of a stored notification; every field is cleaned again and escaped. */
export function renderTelegramText(notification: StoredNotification): string {
  const number = notification.number;
  const numberText = number !== undefined && Number.isSafeInteger(number) && number >= 1 ? ` #${String(number)}` : "";
  const repository = cleanField(notification.repository, MAX_REPOSITORY_CHARACTERS);
  const repositoryText = repository === "" ? "" : ` · ${escapeTelegramHtml(repository)}`;
  const lines = [
    `<b>${escapeTelegramHtml(cleanField(notification.title, MAX_TITLE_CHARACTERS))}</b>${repositoryText}${numberText}`,
  ];
  for (const line of [notification.subject, notification.context, ...(notification.lines ?? [])]) {
    const cleaned = cleanField(line, MAX_LINE_CHARACTERS);
    if (cleaned !== "") {
      lines.push(escapeTelegramHtml(cleaned));
    }
  }
  return lines.join("\n");
}

/** Renders a notification as the three-line Telegram HTML text and its button URL. */
export function formatMessage(notification: Notification): OutboxMessage {
  return { text: renderTelegramText(notification), buttonUrl: buttonUrl(notification.url) };
}
