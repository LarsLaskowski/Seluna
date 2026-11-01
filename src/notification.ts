import { cleanField, MAX_LINE_CHARACTERS, MAX_REPOSITORY_CHARACTERS, MAX_TITLE_CHARACTERS } from "./message";
import type { Notification } from "./rules/rule";

/**
 * A notification as the outbox stores it: the fields of a message without the button URL, channel-neutral (no
 * formatting for any messenger). The fields are cleaned and cut by `storedNotificationOf`.
 */
export interface StoredNotification {
  readonly title: string;
  readonly repository: string;
  readonly number: number | undefined;
  readonly subject: string;
  readonly context: string;
  /**
   * Further lines after `context`, at most `MAX_EXTRA_LINES`; used by the activity digest, absent for every other
   * notification.
   */
  readonly lines?: readonly string[];
}

/** The most entries `StoredNotification.lines` holds: ten repository lines and `and N more repositories`. */
export const MAX_EXTRA_LINES = 11;

/** `number` when it is a safe integer of at least 1, otherwise `undefined`. */
function validNumber(number: number | undefined): number | undefined {
  return number !== undefined && Number.isSafeInteger(number) && number >= 1 ? number : undefined;
}

/** The stored form of `notification`: every field cleaned and cut to its limit, not escaped. */
export function storedNotificationOf(notification: Notification): StoredNotification {
  return {
    title: cleanField(notification.title, MAX_TITLE_CHARACTERS),
    repository: cleanField(notification.repository, MAX_REPOSITORY_CHARACTERS),
    number: validNumber(notification.number),
    subject: cleanField(notification.subject, MAX_LINE_CHARACTERS),
    context: cleanField(notification.context, MAX_LINE_CHARACTERS),
  };
}

/** The JSON text kept in `outbox.text` for a new row. */
export function encodeStoredNotification(notification: StoredNotification): string {
  return JSON.stringify({
    title: notification.title,
    repository: notification.repository,
    number: notification.number ?? null,
    subject: notification.subject,
    context: notification.context,
    ...(notification.lines === undefined || notification.lines.length === 0 ? {} : { lines: notification.lines }),
  });
}

/** The entries of a stored `lines` value: `[]` when absent, `undefined` unless it is at most `MAX_EXTRA_LINES` strings. */
function storedLines(value: unknown): readonly string[] | undefined {
  if (value === undefined) {
    return [];
  }
  const valid =
    Array.isArray(value) &&
    value.length <= MAX_EXTRA_LINES &&
    value.every((entry: unknown) => typeof entry === "string");
  return valid ? value : undefined;
}

/** The notification of a stored JSON text, or `undefined` when the text is not a valid stored notification. */
export function decodeStoredNotification(json: string): StoredNotification | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const { title, repository, number, subject, context, lines } = parsed as Record<string, unknown>; // checked to be a plain object above
  if (
    typeof title !== "string" ||
    typeof repository !== "string" ||
    typeof subject !== "string" ||
    typeof context !== "string"
  ) {
    return undefined;
  }
  const extra = storedLines(lines);
  const validated = typeof number === "number" ? validNumber(number) : undefined;
  if (extra === undefined || (number !== null && validated === undefined)) {
    return undefined;
  }
  const base = { title, repository, number: validated, subject, context };
  return extra.length === 0 ? base : { ...base, lines: extra };
}

const BOLD_OPEN = "<b>";
const TITLE_END = "</b> · ";
const MAX_NUMBER_DIGITS = 16;

/** Reverses Telegram HTML escaping: `&lt;`, `&gt;`, then `&amp;`. */
function unescapeTelegramHtml(text: string): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

/** The trailing ` #<digits>` of `rest` split off as a number, or `rest` unchanged when it holds none. */
function splitNumber(rest: string): { readonly repository: string; readonly number: number | undefined } {
  const mark = rest.lastIndexOf(" #");
  if (mark < 0) {
    return { repository: rest, number: undefined };
  }
  const digits = rest.slice(mark + 2);
  const valid =
    digits.length >= 1 &&
    digits.length <= MAX_NUMBER_DIGITS &&
    !digits.startsWith("0") &&
    Array.from(digits).every((digit) => digit >= "0" && digit <= "9");
  const number = valid ? Number(digits) : undefined;
  return number !== undefined && Number.isSafeInteger(number)
    ? { repository: rest.slice(0, mark), number }
    : { repository: rest, number: undefined };
}

/** The notification read back from an old-form row (Telegram HTML text), or `undefined` when it cannot be read. */
export function legacyNotificationOf(text: string): StoredNotification | undefined {
  if (!text.startsWith(BOLD_OPEN)) {
    return undefined;
  }
  const lines = text.split("\n");
  const [first = "", second = "", third = ""] = lines;
  if (lines.length > 3) {
    return undefined;
  }
  const end = first.indexOf(TITLE_END);
  if (end < 0) {
    return undefined;
  }
  const { repository, number } = splitNumber(first.slice(end + TITLE_END.length));
  return {
    title: unescapeTelegramHtml(first.slice(BOLD_OPEN.length, end)),
    repository: unescapeTelegramHtml(repository),
    number,
    subject: unescapeTelegramHtml(second),
    context: unescapeTelegramHtml(third),
  };
}
