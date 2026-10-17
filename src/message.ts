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
  void text;
  throw new Error("Not implemented");
}

/** `text` cleaned (control and directional characters, lone surrogates) and cut to `maxCharacters` code points; not escaped. */
export function cleanField(text: string, maxCharacters: number): string {
  void [text, maxCharacters];
  throw new Error("Not implemented");
}

/** The normalized `href` when `url` is an `https://github.com` URL within the length limit, otherwise `undefined`. */
export function buttonUrl(url: string): string | undefined {
  void url;
  throw new Error("Not implemented");
}

/** Renders a notification as the three-line Telegram HTML text and its button URL. */
export function formatMessage(notification: Notification): OutboxMessage {
  void notification;
  throw new Error("Not implemented");
}
