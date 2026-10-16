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
  throw new Error("Not implemented");
}

/** Whether the Worker secret `TELEGRAM_CHAT_ID` is a non-empty string. */
export function isChatIdSecretSet(env: object): boolean {
  throw new Error("Not implemented");
}

/** The chat id `text` denotes (`^-?[1-9][0-9]{0,15}$`, safe integer), otherwise `undefined`. */
export function parseChatId(text: string): number | undefined {
  throw new Error("Not implemented");
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
  throw new Error("Not implemented");
}

export type FindChatsResult =
  | { readonly kind: "found"; readonly chats: readonly TelegramChat[] }
  | { readonly kind: "token-rejected" }
  | { readonly kind: "conflict" }
  | { readonly kind: "unavailable" };

/** Calls `getUpdates` once (`token` from `botTokenFromEnv`). Never throws. */
export function findChats(token: string, fetcher: TelegramFetch): Promise<FindChatsResult> {
  throw new Error("Not implemented");
}

export type SendMessageResult = "sent" | "token-rejected" | "failed";

/** Calls `sendMessage` once with plain text (no `parse_mode`). Never throws. */
export function sendMessage(
  token: string,
  chatId: number,
  text: string,
  fetcher: TelegramFetch,
): Promise<SendMessageResult> {
  throw new Error("Not implemented");
}
