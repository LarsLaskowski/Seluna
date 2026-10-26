import {
  CHANNEL_TIMEOUT_MS,
  MAX_CHANNEL_RESPONSE_BYTES,
  MAX_RETRY_WAIT_SECONDS,
  postJson,
  postJsonWithRetry,
} from "./channels/http";
import type { ChannelFetch, HttpAnswer } from "./channels/http";

const BOT_TOKEN_FORM = /^\d{1,20}:[A-Za-z0-9_-]{1,200}$/;
const CHAT_ID_FORM = /^-?[1-9]\d{0,15}$/;
const USERNAME_FORM = /^\w{1,64}$/;
const UPDATE_FIELDS = ["message", "edited_message", "my_chat_member"] as const;

/** Sends one request to the Telegram Bot API; injected so tests never reach the network. */
export type TelegramFetch = ChannelFetch;

/** Name of the Worker secret holding the bot token. */
export const BOT_TOKEN_NAME = "TELEGRAM_BOT_TOKEN";
/** Name of the optional Worker secret that fixes the chat and takes precedence over a chat chosen in the wizard. */
export const CHAT_ID_SECRET_NAME = "TELEGRAM_CHAT_ID";
export const TELEGRAM_API_ORIGIN = "https://api.telegram.org";
/** Largest Bot API answer read, in bytes before decoding: 1 MiB. */
export const MAX_TELEGRAM_RESPONSE_BYTES = MAX_CHANNEL_RESPONSE_BYTES;
/** Each Bot API request is aborted after 10 seconds. */
export const TELEGRAM_TIMEOUT_MS = CHANNEL_TIMEOUT_MS;
/** `getUpdates` asks for the newest this many updates (`offset` is its negative). */
export const GET_UPDATES_LIMIT = 100;
/** A chat name or username is cut to this many code points. */
export const MAX_CHAT_NAME_CHARACTERS = 128;

export type BotToken =
  { readonly kind: "usable"; readonly token: string } | { readonly kind: "missing" } | { readonly kind: "malformed" };

/** `TELEGRAM_BOT_TOKEN` from the Worker environment, checked against the allow-list; never trimmed. */
export function botTokenFromEnv(env: object): BotToken {
  const value: unknown = BOT_TOKEN_NAME in env ? env[BOT_TOKEN_NAME] : undefined;
  if (typeof value !== "string" || value === "") {
    return { kind: "missing" };
  }
  // The token is placed in a URL path, which the URL parser reinterprets in many forms: only this allow-list passes.
  return isBotToken(value) ? { kind: "usable", token: value } : { kind: "malformed" };
}

/** Whether `value` is of the bot token form: digits, a colon, then letters, digits, `-` and `_` (the allow-list). */
export function isBotToken(value: string): boolean {
  return BOT_TOKEN_FORM.test(value);
}

/** Whether the Worker secret `TELEGRAM_CHAT_ID` is a non-empty string. */
export function isChatIdSecretSet(env: object): boolean {
  const value: unknown = CHAT_ID_SECRET_NAME in env ? env[CHAT_ID_SECRET_NAME] : undefined;
  return typeof value === "string" && value !== "";
}

/** The chat id `text` denotes (`^-?[1-9]\d{0,15}$`, safe integer), otherwise `undefined`. */
export function parseChatId(text: string): number | undefined {
  if (!CHAT_ID_FORM.test(text)) {
    return undefined;
  }
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : undefined;
}

export type ChatKind = "private" | "group";

export interface TelegramChat {
  readonly id: number;
  readonly kind: ChatKind;
  /** Display name, at most `MAX_CHAT_NAME_CHARACTERS` code points. */
  readonly name: string;
  /** Without `@`; `undefined` when the chat has none or it is not a valid username. */
  readonly username: string | undefined;
}

/** The chats of a `getUpdates` answer, newest first, or `undefined` when it is not a successful answer. */
export function parseChats(body: unknown): readonly TelegramChat[] | undefined {
  if (!isRecord(body) || body.ok !== true || !Array.isArray(body.result)) {
    return undefined;
  }
  const updates: readonly unknown[] = body.result;
  const seen = new Set<number>();
  const chats: TelegramChat[] = [];
  // The array is oldest first: walking it backwards meets the newest update of each chat first.
  for (const update of [...updates].reverse()) {
    const found = chatOfUpdate(update);
    if (found === undefined || seen.has(found.chat.id)) {
      continue;
    }
    seen.add(found.chat.id);
    if (!found.gone) {
      chats.push(found.chat);
    }
  }
  return chats;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The first `maxCharacters` code points of `text`. */
function cut(text: string, maxCharacters: number): string {
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- code points are counted on purpose
  return [...text].slice(0, maxCharacters).join("");
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function nameOf(chat: Record<string, unknown>, kind: ChatKind, id: number): string {
  let name: string | undefined;
  if (kind === "private") {
    const first = nonEmptyText(chat.first_name);
    const last = nonEmptyText(chat.last_name);
    name = first === undefined || last === undefined ? first : `${first} ${last}`;
  } else {
    name = nonEmptyText(chat.title);
  }
  return cut(name ?? String(id), MAX_CHAT_NAME_CHARACTERS);
}

/** Whether the update says the bot left the chat, was blocked or removed, or that the group moved to a supergroup. */
function isGone(field: (typeof UPDATE_FIELDS)[number], holder: Record<string, unknown>): boolean {
  if (field === "my_chat_member") {
    const member = holder.new_chat_member;
    return isRecord(member) && (member.status === "left" || member.status === "kicked");
  }
  return field === "message" && "migrate_to_chat_id" in holder;
}

/** The chat an update names and whether that update ended the bot's membership, or `undefined` for a skipped update. */
function chatOfUpdate(update: unknown): { readonly chat: TelegramChat; readonly gone: boolean } | undefined {
  if (!isRecord(update)) {
    return undefined;
  }
  for (const field of UPDATE_FIELDS) {
    const holder = update[field];
    if (!isRecord(holder) || !isRecord(holder.chat)) {
      continue;
    }
    const { chat } = holder;
    const { id, type } = chat;
    if (typeof id !== "number" || !Number.isSafeInteger(id)) {
      return undefined;
    }
    let kind: ChatKind;
    if (type === "private") {
      kind = "private";
    } else if (type === "group" || type === "supergroup") {
      kind = "group";
    } else {
      return undefined;
    }
    const { username } = chat;
    const validUsername = kind === "private" && typeof username === "string" && USERNAME_FORM.test(username);
    return {
      chat: { id, kind, name: nameOf(chat, kind, id), username: validUsername ? username : undefined },
      gone: isGone(field, holder),
    };
  }
  return undefined;
}

export type FindChatsResult =
  | { readonly kind: "found"; readonly chats: readonly TelegramChat[] }
  | { readonly kind: "token-rejected" }
  | { readonly kind: "conflict" }
  | { readonly kind: "unavailable" };

/** Calls `getUpdates` once (`token` from `botTokenFromEnv`). Never throws. */
export async function findChats(token: string, fetcher: TelegramFetch): Promise<FindChatsResult> {
  const answer = await callBotApi(
    token,
    "getUpdates",
    { offset: -GET_UPDATES_LIMIT, limit: GET_UPDATES_LIMIT, timeout: 0 },
    fetcher,
  );
  if (answer.kind === "failed") {
    return { kind: "unavailable" };
  }
  if (answer.status === 401 || answer.status === 404) {
    return { kind: "token-rejected" };
  }
  if (answer.status === 409) {
    return { kind: "conflict" };
  }
  const chats = answer.ok ? parseChats(answer.body) : undefined;
  return chats === undefined ? { kind: "unavailable" } : { kind: "found", chats };
}

export type BotTokenCheck = "accepted" | "rejected" | "unavailable";

/**
 * Calls `getMe` once with `token` (of the bot token form): 401 and 404 are `rejected`, a 2xx answer with `ok: true` is
 * `accepted`, everything else is `unavailable`. Only `ok` of the answer is read. Never throws.
 */
export async function verifyBotToken(token: string, fetcher: TelegramFetch): Promise<BotTokenCheck> {
  const answer = await callBotApi(token, "getMe", {}, fetcher);
  if (answer.kind === "failed") {
    return "unavailable";
  }
  if (answer.status === 401 || answer.status === 404) {
    return "rejected";
  }
  return answer.ok && isRecord(answer.body) && answer.body.ok === true ? "accepted" : "unavailable";
}

type BotApiAnswer = HttpAnswer;

/** One POST to a Bot API method with a JSON body; never throws. The body of a non-2xx answer is read only for a 429. */
function callBotApi(token: string, method: string, payload: object, fetcher: TelegramFetch): Promise<BotApiAnswer> {
  return postJson(botUrl(token, method), payload, fetcher);
}

function botUrl(token: string, method: string): string {
  return `${TELEGRAM_API_ORIGIN}/bot${token}/${method}`;
}

export type SendMessageResult = "sent" | "token-rejected" | "failed";

/** Calls `sendMessage` once with plain text (no `parse_mode`). Never throws. */
export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  fetcher: TelegramFetch,
): Promise<SendMessageResult> {
  const answer = await callBotApi(token, "sendMessage", { chat_id: chatId, text }, fetcher);
  if (answer.kind === "failed") {
    return "failed";
  }
  if (answer.status === 401 || answer.status === 404) {
    return "token-rejected";
  }
  return answer.ok && isRecord(answer.body) && answer.body.ok === true ? "sent" : "failed";
}

/** Longest `retry_after`, in seconds, waited for within one attempt. */
export const MAX_RETRY_AFTER_SECONDS = MAX_RETRY_WAIT_SECONDS;

export interface OutgoingMessage {
  readonly text: string;
  readonly buttonText: string;
  readonly buttonUrl: string | undefined;
  readonly silent: boolean;
}

export type SendNotificationResult = "sent" | "token-rejected" | "rate-limited" | "failed";

/** `parameters.retry_after` of an unsuccessful answer as a positive safe integer, else `undefined`. */
export function parseRetryAfter(body: unknown): number | undefined {
  if (!isRecord(body) || body.ok !== false || !isRecord(body.parameters)) {
    return undefined;
  }
  const seconds = body.parameters.retry_after;
  return typeof seconds === "number" && Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined;
}

function notificationResult(answer: BotApiAnswer): SendNotificationResult {
  if (answer.kind === "failed") {
    return "failed";
  }
  if (answer.status === 401 || answer.status === 404) {
    return "token-rejected";
  }
  if (answer.status === 429) {
    return "rate-limited";
  }
  return answer.ok && isRecord(answer.body) && answer.body.ok === true ? "sent" : "failed";
}

/** One `sendMessage` with `parse_mode` HTML, retried once after a 429 of 1–5 s. Never throws. */
export async function sendNotification(
  token: string,
  chatId: number,
  message: OutgoingMessage,
  fetcher: TelegramFetch,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<SendNotificationResult> {
  const payload = {
    chat_id: chatId,
    text: message.text,
    parse_mode: "HTML",
    disable_notification: message.silent,
    link_preview_options: { is_disabled: true },
    ...(message.buttonUrl === undefined
      ? {}
      : { reply_markup: { inline_keyboard: [[{ text: message.buttonText, url: message.buttonUrl }]] } }),
  };
  const answer = await postJsonWithRetry(botUrl(token, "sendMessage"), payload, fetcher, sleep, parseRetryAfter);
  return notificationResult(answer);
}
