import { readSetting, TELEGRAM_CHAT_ID_SETTING, writeSetting } from "../store/settings";
import {
  botTokenFromEnv,
  findChats,
  isChatIdSecretSet,
  parseChatId,
  sendMessage,
} from "../telegram";
import type { TelegramChat, TelegramFetch } from "../telegram";
import { checkChatProof, createChatProof, newChatCode } from "./chat-proof";
import type { Language } from "./language";
import { TEXTS } from "./texts";

export const TELEGRAM_STEP_PATH = "/setup/telegram";
export const CHAT_FIELD = "chat";

export type TelegramProblem = "token-missing" | "token-malformed" | "token-rejected" | "conflict" | "unavailable";

export type TelegramStepView =
  | { readonly kind: "chat-id-secret" }
  | { readonly kind: "problem"; readonly problem: TelegramProblem; readonly savedChatId: number | undefined }
  | { readonly kind: "chats"; readonly chats: readonly TelegramChat[]; readonly savedChatId: number | undefined };

/** What the step page shows; calls `getUpdates` at most once. D1 errors are not caught. */
export async function telegramStepView(
  env: object,
  db: D1Database,
  fetcher: TelegramFetch,
): Promise<TelegramStepView> {
  if (isChatIdSecretSet(env)) {
    return { kind: "chat-id-secret" };
  }
  const stored = await readSetting(db, TELEGRAM_CHAT_ID_SETTING);
  // A stored value that is not a chat id is shown as no saved chat.
  const savedChatId = stored === undefined ? undefined : parseChatId(stored);
  const token = botTokenFromEnv(env);
  switch (token.kind) {
    case "missing":
      return { kind: "problem", problem: "token-missing", savedChatId };
    case "malformed":
      return { kind: "problem", problem: "token-malformed", savedChatId };
    case "usable":
      break;
    default: {
      const unreachable: never = token;
      return unreachable;
    }
  }
  const found = await findChats(token.token, fetcher);
  switch (found.kind) {
    case "found":
      return { kind: "chats", chats: found.chats, savedChatId };
    case "token-rejected":
      return { kind: "problem", problem: "token-rejected", savedChatId };
    case "conflict":
      return { kind: "problem", problem: "conflict", savedChatId };
    case "unavailable":
      return { kind: "problem", problem: "unavailable", savedChatId };
    default: {
      const unreachable: never = found;
      return unreachable;
    }
  }
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
  if (isChatIdSecretSet(env)) {
    return { kind: "chat-id-secret" };
  }
  const [field] = chatFields;
  const chatId = chatFields.length === 1 && field !== undefined ? parseChatId(field) : undefined;
  if (chatId === undefined) {
    return { kind: "invalid-chat" };
  }
  const token = botTokenFromEnv(env);
  if (token.kind === "missing") {
    return { kind: "token-missing" };
  }
  if (token.kind === "malformed") {
    return { kind: "token-malformed" };
  }
  const code = newChatCode();
  const sent = await sendMessage(token.token, chatId, `${TEXTS[language].telegramTestMessage} ${code}`, fetcher);
  switch (sent) {
    case "sent":
      return { kind: "code-sent", chatId, proof: await createChatProof(proofKey, session, chatId, code, now) };
    case "token-rejected":
      return { kind: "token-rejected" };
    case "failed":
      return { kind: "send-failed" };
    default: {
      const unreachable: never = sent;
      return unreachable;
    }
  }
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
