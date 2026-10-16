/** `settings` key of the Telegram chat id chosen in the setup wizard (decimal text). */
export const TELEGRAM_CHAT_ID_SETTING = "telegram_chat_id";

/** The stored value of `key`, or `undefined`. D1 errors are not caught. */
export async function readSetting(db: D1Database, key: string): Promise<string | undefined> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?1").bind(key).first();
  const value = row?.value;
  return typeof value === "string" ? value : undefined;
}

/** Stores `value` under `key`, replacing an earlier value. D1 errors are not caught. */
export async function writeSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}
