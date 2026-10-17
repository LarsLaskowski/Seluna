import type { Language } from "./setup/language";
import { markAttempted, markSent } from "./store/outbox";
import { readSetting, TELEGRAM_CHAT_ID_SETTING } from "./store/settings";
import { botTokenFromEnv, CHAT_ID_SECRET_NAME, isChatIdSecretSet, parseChatId, sendNotification } from "./telegram";
import type { SendNotificationResult, TelegramFetch } from "./telegram";
import { MESSAGE_TEXTS } from "./i18n/messages";

export interface PendingMessage {
  readonly id: number;
  readonly text: string;
  readonly buttonUrl: string | undefined;
  readonly silent: boolean;
}

export type DeliveryResult =
  "sent" | "rate-limited" | "token-rejected" | "failed" | "no-token" | "no-chat" | "store-failed";

export interface DeliveryLogEntry {
  readonly outbox: number;
  readonly result: DeliveryResult;
}

export interface DeliveryDeps {
  readonly env: object;
  readonly db: D1Database;
  readonly fetch: TelegramFetch;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly log: (entry: DeliveryLogEntry) => void;
}

/** `TELEGRAM_CHAT_ID` when set (no fallback if it is not a chat id), else `settings` `telegram_chat_id`. D1 errors reject. */
export async function chatTarget(env: object, db: D1Database): Promise<number | undefined> {
  if (isChatIdSecretSet(env)) {
    const secret: unknown = CHAT_ID_SECRET_NAME in env ? env[CHAT_ID_SECRET_NAME] : undefined;
    return typeof secret === "string" ? parseChatId(secret) : undefined;
  }
  const stored = await readSetting(db, TELEGRAM_CHAT_ID_SETTING);
  return stored === undefined ? undefined : parseChatId(stored);
}

type Target =
  | { readonly kind: "ready"; readonly token: string; readonly chatId: number }
  | { readonly kind: "unavailable"; readonly result: "no-token" | "no-chat" | "store-failed" };

/** The bot token and chat to send to; a database failure reads as `store-failed`. */
async function resolveTarget(deps: DeliveryDeps): Promise<Target> {
  const token = botTokenFromEnv(deps.env);
  if (token.kind !== "usable") {
    return { kind: "unavailable", result: "no-token" };
  }
  try {
    const chatId = await chatTarget(deps.env, deps.db);
    return chatId === undefined
      ? { kind: "unavailable", result: "no-chat" }
      : { kind: "ready", token: token.token, chatId };
  } catch {
    // The error is dropped: only the fixed result reaches the log.
    return { kind: "unavailable", result: "store-failed" };
  }
}

/** Sends one row, records the attempt and returns the result to log. Never rejects. */
async function deliverOne(
  message: PendingMessage,
  target: { readonly token: string; readonly chatId: number },
  buttonText: string,
  deps: DeliveryDeps,
): Promise<DeliveryResult> {
  let sent: SendNotificationResult;
  try {
    sent = await sendNotification(
      target.token,
      target.chatId,
      { text: message.text, buttonText, buttonUrl: message.buttonUrl, silent: message.silent },
      deps.fetch,
      deps.sleep,
    );
  } catch {
    sent = "failed";
  }
  try {
    if (sent === "sent") {
      await markSent(deps.db, message.id);
    } else {
      await markAttempted(deps.db, message.id);
    }
  } catch {
    return "store-failed";
  }
  return sent;
}

/** Sends each row once, in order, updates it and logs it. Never rejects. */
export async function deliverMessages(
  messages: readonly PendingMessage[],
  language: Language,
  deps: DeliveryDeps,
): Promise<void> {
  const target = await resolveTarget(deps);
  const buttonText = MESSAGE_TEXTS[language].openOnGitHub;
  for (const message of messages) {
    const result = target.kind === "ready" ? await deliverOne(message, target, buttonText, deps) : target.result;
    try {
      deps.log({ outbox: message.id, result });
    } catch {
      // A failing log sink must not stop the next row.
    }
  }
}

/** Resolves after `milliseconds` (a timer). */
export function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
