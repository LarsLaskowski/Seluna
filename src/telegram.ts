import { readBodyWithLimit } from "./body";

const BOT_TOKEN_FORM = /^[0-9]{1,20}:[A-Za-z0-9_-]{1,200}$/;
const CHAT_ID_FORM = /^-?[1-9][0-9]{0,15}$/;
const USERNAME_FORM = /^\w{1,64}$/;
const UPDATE_FIELDS = ["message", "edited_message", "my_chat_member"] as const;

/** Sends one request to the Telegram Bot API; injected so tests never reach the network. */
export type TelegramFetch = (request: Request) => Promise<Response>;

/** Name of the Worker secret holding the bot token. */
export const BOT_TOKEN_NAME = "TELEGRAM_BOT_TOKEN";
/** Name of the optional Worker secret that fixes the chat and takes precedence over a chat chosen in the wizard. */
export const CHAT_ID_SECRET_NAME = "TELEGRAM_CHAT_ID";
export const TELEGRAM_API_ORIGIN = "https://api.telegram.org";
/** Largest Bot API answer read, in bytes before decoding: 1 MiB. */
export const MAX_TELEGRAM_RESPONSE_BYTES = 1_048_576;
/** Each Bot API request is aborted after 10 seconds. */
export const TELEGRAM_TIMEOUT_MS = 10_000;
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
  return BOT_TOKEN_FORM.test(value) ? { kind: "usable", token: value } : { kind: "malformed" };
}

/** Whether the Worker secret `TELEGRAM_CHAT_ID` is a non-empty string. */
export function isChatIdSecretSet(env: object): boolean {
  const value: unknown = CHAT_ID_SECRET_NAME in env ? env[CHAT_ID_SECRET_NAME] : undefined;
  return typeof value === "string" && value !== "";
}

/** The chat id `text` denotes (`^-?[1-9][0-9]{0,15}$`, safe integer), otherwise `undefined`. */
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
  for (const update of updates.toReversed()) {
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
  const answer = await callBotApi(token, "getUpdates", { offset: -GET_UPDATES_LIMIT, limit: GET_UPDATES_LIMIT, timeout: 0 }, fetcher);
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

type BotApiAnswer =
  | { readonly kind: "answered"; readonly status: number; readonly ok: boolean; readonly body: unknown }
  | { readonly kind: "failed" };

/** Reads a 2xx answer bounded to 1 MiB; `undefined` when it cannot be read as UTF-8 JSON. */
async function readJson(response: Response): Promise<unknown> {
  const result = await readBodyWithLimit(response, MAX_TELEGRAM_RESPONSE_BYTES);
  if (result.kind !== "ok") {
    return undefined;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(result.body);
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

/** One POST to a Bot API method with a JSON body; never throws. A non-2xx answer is returned without reading its body. */
async function callBotApi(token: string, method: string, payload: object, fetcher: TelegramFetch): Promise<BotApiAnswer> {
  try {
    const request = new Request(`${TELEGRAM_API_ORIGIN}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
    const response = await fetcher(request);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { kind: "answered", status: response.status, ok: false, body: undefined };
    }
    return { kind: "answered", status: response.status, ok: true, body: await readJson(response) };
  } catch {
    // Network errors, aborts and unreadable answers carry nothing the owner can use; the cause is dropped.
    return { kind: "failed" };
  }
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
