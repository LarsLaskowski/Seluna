import { expect, onTestFinished, vi } from "vitest";
import type { Mock } from "vitest";
import type { TelegramFetch } from "../src/telegram";
import getUpdatesConflict from "./fixtures/telegram/get-updates-conflict.json";
import getUpdatesUnauthorized from "./fixtures/telegram/get-updates-unauthorized.json";
import getUpdatesFixture from "./fixtures/telegram/get-updates.json";
import sendMessageTooManyRequestsFixture from "./fixtures/telegram/send-message-too-many-requests.json";
import sendMessageFixture from "./fixtures/telegram/send-message.json";

/*
 * The Telegram Bot API double. Its answers come from test/fixtures/telegram/, which are written from the Bot API
 * reference and not captured from Telegram (see the README.md there).
 */

/** The only Bot API methods Seluna may call. */
const ALLOWED_METHODS: readonly string[] = ["getUpdates", "sendMessage"];
const BOT_URL_PATH = /^\/bot([^/]*)\/([^/]*)$/;

/** The answers of the fixtures, as parsed JSON. */
export const FIXTURES: Readonly<
  Record<"getUpdates" | "unauthorized" | "conflict" | "sendMessage" | "tooManyRequests", unknown>
> = {
  getUpdates: getUpdatesFixture,
  unauthorized: getUpdatesUnauthorized,
  conflict: getUpdatesConflict,
  sendMessage: sendMessageFixture,
  tooManyRequests: sendMessageTooManyRequestsFixture,
};

/** How the double answers one Bot API method. */
export type TelegramAnswer =
  | { readonly kind: "json"; readonly status: number; readonly body: unknown }
  | { readonly kind: "raw"; readonly status: number; readonly body: BodyInit | null }
  | { readonly kind: "reject" };

/** A JSON answer with `status`. */
export function jsonAnswer(status: number, body: unknown): TelegramAnswer {
  return { kind: "json", status, body };
}

/** The answer of a rejected `fetch` (network error, abort). */
export const REJECTED: TelegramAnswer = { kind: "reject" };

/** One request the double received. */
export interface RecordedRequest {
  /** The Bot API method, the last segment of the URL path. */
  readonly method: string;
  /** The bot token, the path segment after `/bot`. */
  readonly token: string;
  readonly origin: string;
  readonly httpMethod: string;
  readonly contentType: string | null;
  /** The body parsed as JSON, or `undefined` when it is not JSON. */
  readonly body: unknown;
  readonly signal: AbortSignal;
}

export interface TelegramDouble {
  /** Pass this as `fetch` of the code under test. */
  readonly fetch: Mock<TelegramFetch>;
  /** Every request received, in order. */
  readonly requests: readonly RecordedRequest[];
  /** The Bot API methods called, in order. */
  methods(): string[];
}

export interface TelegramAnswers {
  readonly getUpdates?: TelegramAnswer;
  /** One answer for every `sendMessage`, or a sequence: the n-th request gets the n-th answer, the last is repeated. */
  readonly sendMessage?: TelegramAnswer | readonly TelegramAnswer[];
}

function isAnswerSequence(answer: TelegramAnswer | readonly TelegramAnswer[]): answer is readonly TelegramAnswer[] {
  return Array.isArray(answer);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function respond(answer: TelegramAnswer): Promise<Response> {
  switch (answer.kind) {
    case "json":
      return Promise.resolve(
        new Response(JSON.stringify(answer.body), {
          status: answer.status,
          headers: { "content-type": "application/json" },
        }),
      );
    case "raw":
      return Promise.resolve(new Response(answer.body, { status: answer.status }));
    case "reject":
      return Promise.reject(new TypeError("Network connection lost"));
    default: {
      const unreachable: never = answer;
      return unreachable;
    }
  }
}

function parseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * A `fetch` that stands in for `https://api.telegram.org`: it records every request and answers `getUpdates` and
 * `sendMessage` as given (by default with the fixtures, status 200; `sendMessage` may be a sequence of answers). A request to another origin or Bot API
 * method is answered with a rejection and fails the test that created the double when the test ends.
 */
export function telegramDouble(answers: TelegramAnswers = {}): TelegramDouble {
  const requests: RecordedRequest[] = [];
  const unexpected: string[] = [];
  const getUpdatesAnswer = answers.getUpdates ?? jsonAnswer(200, FIXTURES.getUpdates);
  const sendMessageAnswers = ((): readonly TelegramAnswer[] => {
    const given = answers.sendMessage ?? jsonAnswer(200, FIXTURES.sendMessage);
    return isAnswerSequence(given) ? given : [given];
  })();
  let sendMessageCount = 0;

  const fetcher = vi.fn<TelegramFetch>(async (request) => {
    const url = new URL(request.url);
    const parts = BOT_URL_PATH.exec(url.pathname);
    const method = parts?.[2] ?? "";
    const text = await request.clone().text();
    requests.push({
      method,
      token: parts?.[1] ?? "",
      origin: url.origin,
      httpMethod: request.method,
      contentType: request.headers.get("content-type"),
      body: parseJson(text),
      signal: request.signal,
    });
    if (url.origin !== "https://api.telegram.org" || !ALLOWED_METHODS.includes(method)) {
      unexpected.push(`${request.method} ${url.origin}${url.pathname}`);
      throw new TypeError("Unexpected Telegram request");
    }
    if (method === "sendMessage") {
      const index = Math.min(sendMessageCount, sendMessageAnswers.length - 1);
      sendMessageCount += 1;
      const answer = sendMessageAnswers[index];
      if (answer === undefined) {
        throw new TypeError("The sendMessage answer sequence is empty");
      }
      return respond(answer);
    }
    return respond(getUpdatesAnswer);
  });

  onTestFinished(() => {
    expect(unexpected, "requests to something other than getUpdates and sendMessage on api.telegram.org").toEqual([]);
  });

  return {
    fetch: fetcher,
    requests,
    methods: () => requests.map((request) => request.method),
  };
}

/** The updates of the `get-updates.json` fixture as fresh copies (oldest first), safe to change in a test. */
export function fixtureUpdates(): Record<string, unknown>[] {
  const copy: unknown = structuredClone(FIXTURES.getUpdates);
  const result = isRecord(copy) ? copy.result : undefined;
  if (!Array.isArray(result) || !result.every(isRecord)) {
    throw new TypeError("get-updates.json has no result array of objects");
  }
  return result;
}

/** A fresh copy of the update with `update_id` from the `get-updates.json` fixture. */
export function fixtureUpdate(updateId: number): Record<string, unknown> {
  const update = fixtureUpdates().find((candidate) => candidate.update_id === updateId);
  if (update === undefined) {
    throw new TypeError(`get-updates.json has no update ${String(updateId)}`);
  }
  return update;
}

/** The `message`, `edited_message` or `my_chat_member` object of `update` (the same object, not a copy) that holds a `chat`. */
export function chatHolderOf(update: Record<string, unknown>): Record<string, unknown> {
  for (const field of ["message", "edited_message", "my_chat_member"]) {
    const holder = update[field];
    if (isRecord(holder) && isRecord(holder.chat)) {
      return holder;
    }
  }
  throw new TypeError("The update has no message, edited_message or my_chat_member with a chat");
}

/** The `chat` object (the same object, not a copy) of `update`. */
export function chatOf(update: Record<string, unknown>): Record<string, unknown> {
  const { chat } = chatHolderOf(update);
  if (!isRecord(chat)) {
    throw new TypeError("The update has no chat");
  }
  return chat;
}

/** The `new_chat_member` object (the same object, not a copy) of the `my_chat_member` of `update`. */
export function newChatMemberOf(update: Record<string, unknown>): Record<string, unknown> {
  const { my_chat_member: holder } = update;
  if (!isRecord(holder) || !isRecord(holder.new_chat_member)) {
    throw new TypeError("The update has no my_chat_member with a new_chat_member");
  }
  return holder.new_chat_member;
}

/** A successful `getUpdates` answer with `updates` as its result. */
export function updatesAnswer(updates: readonly unknown[]): { readonly ok: true; readonly result: readonly unknown[] } {
  return { ok: true, result: updates };
}
