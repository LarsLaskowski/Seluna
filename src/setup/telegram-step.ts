import type { BotTokenSource } from "../bot-token";
import { TELEGRAM_CHAT_ID_SETTING, writeSetting } from "../store/settings";
import { isChatIdSecretSet } from "../telegram";
import type { TelegramChat, TelegramFetch } from "../telegram";
import { checkChatProof } from "./chat-proof";
import type { Language } from "./language";

export const TELEGRAM_STEP_PATH = "/setup/telegram";
export const CHAT_FIELD = "chat";

export const TELEGRAM_TOKEN_PATH = "/setup/telegram/token";
export const TELEGRAM_TOKEN_REMOVE_PATH = "/setup/telegram/token/remove";
export const TOKEN_FIELD = "token";

/** What the token card of the step shows. `rejected`: Telegram no longer accepts the token in use. */
export type TokenState =
  | { readonly kind: "worker-secret"; readonly rejected: boolean }
  | { readonly kind: "worker-secret-malformed" }
  | { readonly kind: "missing" }
  | { readonly kind: "entry" }
  | { readonly kind: "saved"; readonly rejected: boolean }
  | { readonly kind: "unreadable" }
  | { readonly kind: "damaged" };

export type TelegramProblem = "conflict" | "unavailable";

/** What the chat card of the step shows. */
export type ChatPart =
  | { readonly kind: "chat-id-secret" }
  | { readonly kind: "omitted" }
  | { readonly kind: "hidden"; readonly savedChatId: number | undefined }
  | { readonly kind: "problem"; readonly problem: TelegramProblem; readonly savedChatId: number | undefined }
  | { readonly kind: "chats"; readonly chats: readonly TelegramChat[]; readonly savedChatId: number | undefined };

export interface TelegramStepView {
  readonly kind: "step";
  readonly token: TokenState;
  readonly chat: ChatPart;
}

/**
 * What the step page shows: the token state from `resolveBotToken` and the chat part; calls `getUpdates` at most once
 * and only with a usable token while `TELEGRAM_CHAT_ID` is not set. D1 errors are not caught.
 */
/* eslint-disable @typescript-eslint/no-unused-vars -- skeleton: the implementation uses the parameters */
export function telegramStepView(env: object, db: D1Database, fetcher: TelegramFetch): Promise<TelegramStepView> {
  return Promise.reject(new Error("Not implemented"));
}
/* eslint-enable @typescript-eslint/no-unused-vars */

export const TELEGRAM_VERIFY_PATH = "/setup/telegram/verify";
export const PROOF_FIELD = "proof";
export const CODE_FIELD = "code";

export type ConfirmChatResult =
  | { readonly kind: "code-sent"; readonly chatId: number; readonly proof: string }
  | { readonly kind: "chat-id-secret" }
  | { readonly kind: "invalid-chat" }
  | { readonly kind: "token-missing" }
  | { readonly kind: "token-malformed" }
  | { readonly kind: "token-rejected"; readonly source: BotTokenSource }
  | { readonly kind: "send-failed" };

/**
 * Sends a test message with a new code to the one chat in `chatFields` and returns the proof for it; stores nothing.
 * The token comes from `resolveBotToken`. D1 errors are not caught.
 */
/* eslint-disable @typescript-eslint/no-unused-vars -- skeleton: the implementation uses the parameters */
export function confirmTelegramChat(
  env: object,
  db: D1Database,
  fetcher: TelegramFetch,
  proofKey: CryptoKey,
  session: string,
  chatFields: readonly string[],
  language: Language,
  now: Date,
): Promise<ConfirmChatResult> {
  return Promise.reject(new Error("Not implemented"));
}
/* eslint-enable @typescript-eslint/no-unused-vars */

export type SaveTokenResult =
  | { readonly kind: "saved" }
  | { readonly kind: "worker-secret" }
  | { readonly kind: "invalid" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "not-writable" }
  | { readonly kind: "rejected" }
  | { readonly kind: "unavailable" };

/**
 * Checks the one token of the token form against the allow-list, asks Telegram once (`getMe`) and saves the token
 * encrypted when Telegram accepts it. D1 errors are not caught.
 */
/* eslint-disable @typescript-eslint/no-unused-vars -- skeleton: the implementation uses the parameters */
export function saveBotToken(
  env: object,
  db: D1Database,
  fetcher: TelegramFetch,
  tokenFields: readonly string[],
): Promise<SaveTokenResult> {
  return Promise.reject(new Error("Not implemented"));
}
/* eslint-enable @typescript-eslint/no-unused-vars */

export type RemoveTokenResult =
  { readonly kind: "removed" } | { readonly kind: "worker-secret" } | { readonly kind: "unreadable" };

/** Deletes the saved bot token (also when none is saved); calls no Telegram API. D1 errors are not caught. */
/* eslint-disable @typescript-eslint/no-unused-vars -- skeleton: the implementation uses the parameters */
export function removeBotToken(env: object, db: D1Database): Promise<RemoveTokenResult> {
  return Promise.reject(new Error("Not implemented"));
}
/* eslint-enable @typescript-eslint/no-unused-vars */

export type VerifyChatResult =
  | { readonly kind: "saved" }
  | { readonly kind: "chat-id-secret" }
  | { readonly kind: "code-expired" }
  | { readonly kind: "wrong-code"; readonly chatId: number; readonly proof: string };

/** Checks the one proof and code of the verify form and stores the proof's chat. Calls no Telegram API. D1 errors are not caught. */
export async function verifyTelegramChat(
  env: object,
  db: D1Database,
  proofKey: CryptoKey,
  session: string,
  proofFields: readonly string[],
  codeFields: readonly string[],
  now: Date,
): Promise<VerifyChatResult> {
  if (isChatIdSecretSet(env)) {
    return { kind: "chat-id-secret" };
  }
  const [proof] = proofFields;
  if (proofFields.length !== 1 || proof === undefined) {
    return { kind: "code-expired" };
  }
  const [code] = codeFields;
  // A missing or repeated code is a wrong code; the empty text never passes the check.
  const check = await checkChatProof(proofKey, proof, session, codeFields.length === 1 ? (code ?? "") : "", now);
  switch (check.kind) {
    case "invalid":
      return { kind: "code-expired" };
    case "wrong-code":
      return { kind: "wrong-code", chatId: check.chatId, proof };
    case "valid":
      await writeSetting(db, TELEGRAM_CHAT_ID_SETTING, String(check.chatId));
      return { kind: "saved" };
    default: {
      const unreachable: never = check;
      return unreachable;
    }
  }
}
