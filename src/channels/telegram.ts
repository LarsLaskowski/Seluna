import { readSetting, TELEGRAM_CHAT_ID_SETTING } from "../store/settings";
import { removeBotToken, resolveBotToken } from "../bot-token";
import { renderTelegramText } from "../message";
import { CHAT_ID_SECRET_NAME, isChatIdSecretSet, parseChatId, sendNotification } from "../telegram";
import type { Channel, ChannelMessage, ChannelSendDeps, ChannelSendResult, SendOptions } from "./channel";

/** `TELEGRAM_CHAT_ID` when set (no fallback if it is not a chat id), else `settings` `telegram_chat_id`. D1 errors reject. */
export async function chatTarget(env: object, db: D1Database): Promise<number | undefined> {
  if (isChatIdSecretSet(env)) {
    const secret: unknown = CHAT_ID_SECRET_NAME in env ? env[CHAT_ID_SECRET_NAME] : undefined;
    return typeof secret === "string" ? parseChatId(secret) : undefined;
  }
  const stored = await readSetting(db, TELEGRAM_CHAT_ID_SETTING);
  return stored === undefined ? undefined : parseChatId(stored);
}

/** Sends one message through the Bot API with the resolved token and chat. Never rejects. */
async function sendThroughBotApi(
  token: string,
  chatId: number,
  message: ChannelMessage,
  options: SendOptions,
  deps: ChannelSendDeps,
): Promise<ChannelSendResult> {
  const { content } = message;
  const text = content.kind === "notification" ? renderTelegramText(content.notification) : content.text;
  const sent = await sendNotification(
    token,
    chatId,
    { text, buttonText: options.buttonLabel, buttonUrl: message.buttonUrl, silent: options.silent },
    deps.fetch,
    deps.sleep,
  );
  return sent === "token-rejected" ? "rejected" : sent;
}

/** The Telegram channel. */
export const TELEGRAM_CHANNEL: Channel = {
  id: "telegram",
  displayName: "Telegram",
  setupPath: "/setup/telegram",
  prepare: async (env, db) => {
    const token = await resolveBotToken(env, db);
    if (token.kind !== "usable") {
      return { kind: "unavailable", result: "no-token" };
    }
    const chatId = await chatTarget(env, db);
    if (chatId === undefined) {
      return { kind: "unavailable", result: "no-chat" };
    }
    return {
      kind: "ready",
      send: (message, options, deps) => sendThroughBotApi(token.token, chatId, message, options, deps),
    };
  },
  hasRemovableCredentials: async (env, db) => {
    const token = await resolveBotToken(env, db);
    return (token.kind === "usable" && token.source === "saved") || token.kind === "damaged";
  },
  remove: async (env, db) => {
    const result = await removeBotToken(env, db);
    return result.kind;
  },
};
