import type { Language } from "./setup/language";
import type { TelegramFetch } from "./telegram";

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
  void [env, db];
  return Promise.reject(new Error("Not implemented"));
}

/** Sends each row once, in order, updates it and logs it. Never rejects. */
export async function deliverMessages(
  messages: readonly PendingMessage[],
  language: Language,
  deps: DeliveryDeps,
): Promise<void> {
  void [messages, language, deps];
  return Promise.reject(new Error("Not implemented"));
}

/** Resolves after `milliseconds` (a timer). */
export function wait(milliseconds: number): Promise<void> {
  void milliseconds;
  return Promise.reject(new Error("Not implemented"));
}
