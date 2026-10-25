import { resolveBotToken } from "../bot-token";
import type { BotTokenSource, ResolvedBotToken } from "../bot-token";
import { keyFromEnv } from "../crypto";
import { checkKey, deleteSecret, writeSecret } from "../store/secrets";
import { readSetting, TELEGRAM_CHAT_ID_SETTING, writeSetting } from "../store/settings";
import {
  botTokenFromEnv,
  findChats,
  isBotToken,
  isChatIdSecretSet,
  parseChatId,
  sendMessage,
  verifyBotToken,
} from "../telegram";
import type { TelegramChat, TelegramFetch } from "../telegram";
import { checkChatProof, createChatProof, newChatCode } from "./chat-proof";
import type { Language } from "./language";
import { TEXTS } from "./texts";

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

/** The token card's state for `resolved`; `rejected` is false because no Telegram request is made. */
function tokenStateOfResolved(resolved: ResolvedBotToken): TokenState {
  switch (resolved.kind) {
    case "usable":
      return resolved.source === "worker-secret"
        ? { kind: "worker-secret", rejected: false }
        : { kind: "saved", rejected: false };
    case "malformed":
      return { kind: "worker-secret-malformed" };
    case "missing":
      return { kind: "missing" };
    case "unreadable":
      return { kind: "unreadable" };
    case "damaged":
      return { kind: "damaged" };
    default: {
      const unreachable: never = resolved;
      return unreachable;
    }
  }
}

/** The token card's state without any Telegram request. D1 errors are not caught. */
export async function tokenState(env: object, db: D1Database): Promise<TokenState> {
  return tokenStateOfResolved(await resolveBotToken(env, db));
}

/** The chat part for a usable token: the chats `getUpdates` lists, or the problem; `rejected` when the token is refused. */
async function searchedChat(
  token: string,
  fetcher: TelegramFetch,
  savedChatId: number | undefined,
): Promise<{ readonly chat: ChatPart; readonly rejected: boolean }> {
  const found = await findChats(token, fetcher);
  switch (found.kind) {
    case "found":
      return { chat: { kind: "chats", chats: found.chats, savedChatId }, rejected: false };
    case "token-rejected":
      return { chat: { kind: "hidden", savedChatId }, rejected: true };
    case "conflict":
    case "unavailable":
      return { chat: { kind: "problem", problem: found.kind, savedChatId }, rejected: false };
    default: {
      const unreachable: never = found;
      return unreachable;
    }
  }
}

/**
 * What the step page shows: the token state from `resolveBotToken` and the chat part; calls `getUpdates` at most once
 * and only with a usable token while `TELEGRAM_CHAT_ID` is not set. D1 errors are not caught.
 */
export async function telegramStepView(env: object, db: D1Database, fetcher: TelegramFetch): Promise<TelegramStepView> {
  const resolved = await resolveBotToken(env, db);
  const token = tokenStateOfResolved(resolved);
  if (isChatIdSecretSet(env)) {
    return { kind: "step", token, chat: { kind: "chat-id-secret" } };
  }
  const stored = await readSetting(db, TELEGRAM_CHAT_ID_SETTING);
  // A stored value that is not a chat id is shown as no saved chat.
  const savedChatId = stored === undefined ? undefined : parseChatId(stored);
  if (resolved.kind !== "usable") {
    return { kind: "step", token, chat: { kind: "hidden", savedChatId } };
  }
  const { chat, rejected } = await searchedChat(resolved.token, fetcher, savedChatId);
  if (!rejected) {
    return { kind: "step", token, chat };
  }
  return {
    kind: "step",
    token: { kind: resolved.source === "saved" ? "saved" : "worker-secret", rejected: true },
    chat,
  };
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
  | { readonly kind: "token-rejected"; readonly source: BotTokenSource }
  | { readonly kind: "send-failed" };

/**
 * Sends a test message with a new code to the one chat in `chatFields` and returns the proof for it; stores nothing.
 * The token comes from `resolveBotToken`. D1 errors are not caught.
 */
export async function confirmTelegramChat(
  env: object,
  db: D1Database,
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
  const token = await resolveBotToken(env, db);
  switch (token.kind) {
    case "missing":
    case "unreadable":
    case "damaged":
      return { kind: "token-missing" };
    case "malformed":
      return { kind: "token-malformed" };
    case "usable":
      break;
    default: {
      const unreachable: never = token;
      return unreachable;
    }
  }
  const code = newChatCode();
  const sent = await sendMessage(token.token, chatId, `${TEXTS[language].telegramTestMessage} ${code}`, fetcher);
  switch (sent) {
    case "sent":
      return { kind: "code-sent", chatId, proof: await createChatProof(proofKey, session, chatId, code, now) };
    case "token-rejected":
      return { kind: "token-rejected", source: token.source };
    case "failed":
      return { kind: "send-failed" };
    default: {
      const unreachable: never = sent;
      return unreachable;
    }
  }
}

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
export async function saveBotToken(
  env: object,
  db: D1Database,
  fetcher: TelegramFetch,
  tokenFields: readonly string[],
): Promise<SaveTokenResult> {
  if (botTokenFromEnv(env).kind !== "missing") {
    return { kind: "worker-secret" };
  }
  const [token] = tokenFields;
  // The allow-list is applied before the value reaches any Bot API URL; the value is never trimmed.
  if (tokenFields.length !== 1 || token === undefined || !isBotToken(token)) {
    return { kind: "invalid" };
  }
  if ((await resolveBotToken(env, db)).kind === "unreadable") {
    return { kind: "unreadable" };
  }
  const key = await keyFromEnv(env);
  if (key === undefined) {
    return { kind: "not-writable" };
  }
  const keyCheck = await checkKey(db, key);
  if (keyCheck === "changed" || keyCheck === "corrupt") {
    return { kind: "not-writable" };
  }
  const verified = await verifyBotToken(token, fetcher);
  if (verified !== "accepted") {
    return { kind: verified };
  }
  const written = await writeSecret(db, key, "telegram_bot_token", token);
  return written.kind === "ok" ? { kind: "saved" } : { kind: "not-writable" };
}

export type RemoveTokenResult =
  { readonly kind: "removed" } | { readonly kind: "worker-secret" } | { readonly kind: "unreadable" };

/** Deletes the saved bot token (also when none is saved); calls no Telegram API. D1 errors are not caught. */
export async function removeBotToken(env: object, db: D1Database): Promise<RemoveTokenResult> {
  if (botTokenFromEnv(env).kind !== "missing") {
    return { kind: "worker-secret" };
  }
  if ((await resolveBotToken(env, db)).kind === "unreadable") {
    return { kind: "unreadable" };
  }
  await deleteSecret(db, "telegram_bot_token");
  return { kind: "removed" };
}

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
