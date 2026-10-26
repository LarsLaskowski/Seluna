import { settingsFromStored, settingsToStored } from "../settings";
import type { NotificationSettings } from "../settings";

/** `settings` key of the Telegram chat id chosen in the setup wizard (decimal text). */
export const TELEGRAM_CHAT_ID_SETTING = "telegram_chat_id";

/** `settings` key of the active delivery channel id. */
export const DELIVERY_CHANNEL_SETTING = "delivery_channel";

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

const UPSERT_SETTING =
  "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value";

/** Every `settings` row as a map from key to value. D1 errors are not caught. */
export async function readSettings(db: D1Database): Promise<ReadonlyMap<string, string>> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all();
  const rows = new Map<string, string>();
  for (const row of results) {
    const { key, value } = row;
    if (typeof key === "string" && typeof value === "string") {
      rows.set(key, value);
    }
  }
  return rows;
}

/** The notification settings; an absent or invalid row reads as its default. D1 errors are not caught. */
export async function readNotificationSettings(db: D1Database): Promise<NotificationSettings> {
  return settingsFromStored(await readSettings(db));
}

/** Stores every notification setting in one batch. D1 errors are not caught. */
export async function writeNotificationSettings(db: D1Database, settings: NotificationSettings): Promise<void> {
  await db.batch(settingsToStored(settings).map(([key, value]) => db.prepare(UPSERT_SETTING).bind(key, value)));
}
