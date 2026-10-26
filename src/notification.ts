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
}

/** The stored form of `notification`: every field cleaned and cut to its limit, not escaped. */
export function storedNotificationOf(notification: Notification): StoredNotification {
  throw new Error("Not implemented");
}

/** The JSON text kept in `outbox.text` for a new row. */
export function encodeStoredNotification(notification: StoredNotification): string {
  throw new Error("Not implemented");
}

/** The notification of a stored JSON text, or `undefined` when the text is not a valid stored notification. */
export function decodeStoredNotification(json: string): StoredNotification | undefined {
  throw new Error("Not implemented");
}

/** The notification read back from an old-form row (Telegram HTML text), or `undefined` when it cannot be read. */
export function legacyNotificationOf(text: string): StoredNotification | undefined {
  throw new Error("Not implemented");
}
