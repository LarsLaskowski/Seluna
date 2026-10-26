import { readSetting, TELEGRAM_CHAT_ID_SETTING } from "../store/settings";
import { CHAT_ID_SECRET_NAME, isChatIdSecretSet, parseChatId } from "../telegram";
import type { Channel } from "./channel";

/** `TELEGRAM_CHAT_ID` when set (no fallback if it is not a chat id), else `settings` `telegram_chat_id`. D1 errors reject. */
export async function chatTarget(env: object, db: D1Database): Promise<number | undefined> {
  if (isChatIdSecretSet(env)) {
    const secret: unknown = CHAT_ID_SECRET_NAME in env ? env[CHAT_ID_SECRET_NAME] : undefined;
    return typeof secret === "string" ? parseChatId(secret) : undefined;
  }
  const stored = await readSetting(db, TELEGRAM_CHAT_ID_SETTING);
  return stored === undefined ? undefined : parseChatId(stored);
}

/** The Telegram channel. */
export const TELEGRAM_CHANNEL: Channel = {
  id: "telegram",
  displayName: "Telegram",
  setupPath: "/setup/telegram",
  prepare: () => {
    throw new Error("Not implemented");
  },
  hasRemovableCredentials: () => {
    throw new Error("Not implemented");
  },
  remove: () => {
    throw new Error("Not implemented");
  },
};
