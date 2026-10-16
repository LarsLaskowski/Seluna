import type { TelegramChat, TelegramFetch } from "../telegram";
import type { Language } from "./language";

export const TELEGRAM_STEP_PATH = "/setup/telegram";
export const CHAT_FIELD = "chat";

export type TelegramProblem = "token-missing" | "token-malformed" | "token-rejected" | "conflict" | "unavailable";

export type TelegramStepView =
  | { readonly kind: "chat-id-secret" }
  | { readonly kind: "problem"; readonly problem: TelegramProblem; readonly savedChatId: number | undefined }
  | { readonly kind: "chats"; readonly chats: readonly TelegramChat[]; readonly savedChatId: number | undefined };

/** What the step page shows; calls `getUpdates` at most once. D1 errors are not caught. */
export function telegramStepView(env: object, db: D1Database, fetcher: TelegramFetch): Promise<TelegramStepView> {
  throw new Error("Not implemented");
}

export const TELEGRAM_VERIFY_PATH = "/setup/telegram/verify";
export const PROOF_FIELD = "proof";
export const CODE_FIELD = "code";

export type ConfirmChatResult =
  | { readonly kind: "code-sent"; readonly chatId: number; readonly proof: string }
  | { readonly kind: "chat-id-secret" }
  | { readonly kind: "invalid-chat" }
  | { readonly kind: "token-missing" }
  | { readonly kind: "token-malformed" }
  | { readonly kind: "token-rejected" }
  | { readonly kind: "send-failed" };

/** Sends a test message with a new code to the one chat in `chatFields` and returns the proof for it; stores nothing. */
export function confirmTelegramChat(
  env: object,
  fetcher: TelegramFetch,
  proofKey: CryptoKey,
  session: string,
  chatFields: readonly string[],
  language: Language,
  now: Date,
): Promise<ConfirmChatResult> {
  throw new Error("Not implemented");
}

export type VerifyChatResult =
  | { readonly kind: "saved" }
  | { readonly kind: "chat-id-secret" }
  | { readonly kind: "code-expired" }
  | { readonly kind: "wrong-code"; readonly chatId: number; readonly proof: string };

/** Checks the one proof and code of the verify form and stores the proof's chat. Calls no Telegram API. D1 errors are not caught. */
export function verifyTelegramChat(
  env: object,
  db: D1Database,
  proofKey: CryptoKey,
  session: string,
  proofFields: readonly string[],
  codeFields: readonly string[],
  now: Date,
): Promise<VerifyChatResult> {
  throw new Error("Not implemented");
}
