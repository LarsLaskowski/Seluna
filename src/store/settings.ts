/** `settings` key of the Telegram chat id chosen in the setup wizard (decimal text). */
export const TELEGRAM_CHAT_ID_SETTING = "telegram_chat_id";

/** The stored value of `key`, or `undefined`. D1 errors are not caught. */
export function readSetting(db: D1Database, key: string): Promise<string | undefined> {
  throw new Error("Not implemented");
}

/** Stores `value` under `key`, replacing an earlier value. D1 errors are not caught. */
export function writeSetting(db: D1Database, key: string, value: string): Promise<void> {
  throw new Error("Not implemented");
}
