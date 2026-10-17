import { describe, expect, it, vi } from "vitest";
import {
  botTokenFromEnv,
  findChats,
  isChatIdSecretSet,
  MAX_CHAT_NAME_CHARACTERS,
  MAX_TELEGRAM_RESPONSE_BYTES,
  parseChatId,
  parseChats,
  parseRetryAfter,
  sendMessage,
  sendNotification,
} from "./telegram";
import type { TelegramChat } from "./telegram";
import {
  chatHolderOf,
  chatOf,
  fixtureUpdate,
  fixtureUpdates,
  FIXTURES,
  jsonAnswer,
  newChatMemberOf,
  REJECTED,
  telegramDouble,
  updatesAnswer,
} from "../test/telegram";
import type { TelegramAnswer } from "../test/telegram";

const TOKEN = "123456789:AAH-throwaway_token0123456789abcdefghij";

/** The chats of `get-updates.json`, newest first, as the reference-built fixture documents them. */
const FIXTURE_CHATS: readonly TelegramChat[] = [
  { id: 5003003, kind: "private", name: "Clara", username: undefined },
  { id: 5002002, kind: "private", name: "Bernd", username: undefined },
  { id: -1001234567890, kind: "group", name: "Seluna Supergroup", username: undefined },
  { id: -4001001, kind: "group", name: "Seluna Testgroup", username: undefined },
  { id: 5001001, kind: "private", name: "Anna Beispiel", username: "anna_example" },
];

const ANNA_MESSAGE = 100001;
const TEST_GROUP_MEMBER_UPDATE = 100002;
const OLD_GROUP_MESSAGE = 100008;
const OLD_GROUP_LEFT = 100009;
const MIGRATED_MESSAGE = 100010;

/** An update (a copy of the fixture's update `base`) with a new id, so it can be appended to an answer. */
function laterUpdate(base: number, updateId: number): Record<string, unknown> {
  const update = fixtureUpdate(base);
  update.update_id = updateId;
  return update;
}

function codePoints(text: string): number {
  return Array.from(text).length;
}

describe("botTokenFromEnv", () => {
  it.each([
    { name: "absent", env: {} },
    { name: "empty", env: { TELEGRAM_BOT_TOKEN: "" } },
    { name: "a number", env: { TELEGRAM_BOT_TOKEN: 123456 } },
    { name: "null", env: { TELEGRAM_BOT_TOKEN: null } },
    { name: "an object", env: { TELEGRAM_BOT_TOKEN: { token: TOKEN } } },
  ])("botTokenFromEnv reports missing for an absent, empty or non-string token: $name", ({ env }) => {
    const token = botTokenFromEnv(env);

    expect(token, "result").toEqual({ kind: "missing" });
  });

  it.each([
    { name: "a slash that starts another method", value: "1:a/../setWebhook" },
    { name: "a backslash", value: "1:a\\..\\setWebhook" },
    { name: "a question mark", value: "1:a?x=y" },
    { name: "a number sign", value: "1:a#x" },
    { name: "a percent-encoded slash", value: "1:a%2F..%2FsetWebhook" },
    { name: "a percent-encoded dot segment", value: "1:a%2e%2e" },
    { name: "a lone percent sign", value: "1:a%" },
    { name: "a dot", value: "1:a.b" },
    { name: "a dot segment", value: "1:.." },
    { name: "a tab inside", value: "1:a\tb" },
    { name: "a line feed inside", value: "1:a\nb" },
    { name: "a carriage return inside", value: "1:a\rb" },
    { name: "a line feed at the end", value: "123:abc\n" },
    { name: "a tab at the end", value: "123:abc\t" },
    { name: "a space inside", value: "1:a b" },
    { name: "a leading space", value: " 123:abc" },
    { name: "a trailing space", value: "123:abc " },
    { name: "a C0 control", value: "123:abc\u0001" },
    { name: "a C1 control", value: "123:abc\u0085" },
    { name: "a non-ASCII digit in the id", value: "١٢:abc" },
    { name: "a non-ASCII letter in the secret", value: "1:äbc" },
    { name: "an at sign", value: "1:a@b" },
    { name: "a second colon", value: "1:a:b" },
    { name: "a semicolon", value: "1:a;b" },
    { name: "an equals sign", value: "1:a=b" },
    { name: "a plus sign", value: "1:a+b" },
    { name: "no colon", value: "123456789" },
    { name: "text only", value: "abc" },
    { name: "an empty id", value: ":abc" },
    { name: "an empty secret", value: "123:" },
    { name: "21 digits in the id", value: `${"9".repeat(21)}:abc` },
    { name: "201 characters in the secret", value: `1:${"a".repeat(201)}` },
  ])("botTokenFromEnv reports malformed for every form the URL parser would reinterpret: $name", ({ value }) => {
    const token = botTokenFromEnv({ TELEGRAM_BOT_TOKEN: value });

    expect(token, "result").toEqual({ kind: "malformed" });
  });

  it.each([
    { name: "a typical token", value: TOKEN },
    { name: "the shortest token", value: "1:a" },
    { name: "an id of 20 digits and a secret of 200 characters", value: `${"9".repeat(20)}:${"a".repeat(200)}` },
    { name: "every allowed character", value: "0123456789:AZaz09-_" },
  ])("botTokenFromEnv accepts a token of digits, a colon and letters, digits, - and _: $name", ({ value }) => {
    const token = botTokenFromEnv({ TELEGRAM_BOT_TOKEN: value });

    expect(token, "result").toEqual({ kind: "usable", token: value });
  });
});

describe("isChatIdSecretSet", () => {
  it.each([
    { name: "a private chat id", env: { TELEGRAM_CHAT_ID: "123456789" }, expected: true },
    { name: "a negative group id", env: { TELEGRAM_CHAT_ID: "-1001234567890" }, expected: true },
    { name: "a single space", env: { TELEGRAM_CHAT_ID: " " }, expected: true },
    { name: "absent", env: {}, expected: false },
    { name: "empty", env: { TELEGRAM_CHAT_ID: "" }, expected: false },
    { name: "a number", env: { TELEGRAM_CHAT_ID: 123456789 }, expected: false },
    { name: "null", env: { TELEGRAM_CHAT_ID: null }, expected: false },
    { name: "undefined", env: { TELEGRAM_CHAT_ID: undefined }, expected: false },
  ])("isChatIdSecretSet is true only for a non-empty string: $name", ({ env, expected }) => {
    const set = isChatIdSecretSet(env);

    expect(set, "result").toBe(expected);
  });
});

describe("parseChatId", () => {
  it.each([
    { text: "1", expected: 1 },
    { text: "123456789", expected: 123_456_789 },
    { text: "-4001001", expected: -4_001_001 },
    { text: "-1001234567890", expected: -1_001_234_567_890 },
    { text: "9007199254740991", expected: 9_007_199_254_740_991 },
    { text: "-9007199254740991", expected: -9_007_199_254_740_991 },
  ])("parseChatId accepts a private and a supergroup id: $text", ({ text, expected }) => {
    const id = parseChatId(text);

    expect(id, "chat id").toBe(expected);
  });

  it.each([
    { name: "empty", text: "" },
    { name: "zero", text: "0" },
    { name: "minus zero", text: "-0" },
    { name: "a leading plus", text: "+1" },
    { name: "leading zeros", text: "0123" },
    { name: "negative with leading zeros", text: "-0123" },
    { name: "a lone minus", text: "-" },
    { name: "a leading space", text: " 1" },
    { name: "a trailing space", text: "1 " },
    { name: "a space inside", text: "1 2" },
    { name: "a trailing line feed", text: "1\n" },
    { name: "an exponent", text: "1e5" },
    { name: "hexadecimal", text: "0x10" },
    { name: "a decimal point", text: "1.0" },
    { name: "non-ASCII digits", text: "١٢٣" },
    { name: "a channel name", text: "@channelname" },
    { name: "17 digits", text: "12345678901234567" },
    { name: "16 digits above the largest safe integer", text: "9007199254740992" },
    { name: "negative 16 digits above the largest safe integer", text: "-9999999999999999" },
  ])("parseChatId rejects every other form: $name", ({ text }) => {
    const id = parseChatId(text);

    expect(id, "chat id").toBeUndefined();
  });
});

describe("parseChats", () => {
  it("parseChats lists the private chat and the group of the getUpdates fixture", () => {
    const chats = parseChats(FIXTURES.getUpdates);

    expect(chats, "chats of the fixture, newest first").toEqual(FIXTURE_CHATS);
  });

  it("parseChats lists a supergroup as a group", () => {
    const answer = updatesAnswer(fixtureUpdates().filter((update) => update.update_id === 100004));

    const chats = parseChats(answer);

    expect(chats, "the supergroup").toEqual([
      { id: -1001234567890, kind: "group", name: "Seluna Supergroup", username: undefined },
    ]);
  });

  it("parseChats lists each chat once, newest first, named by its newest update", () => {
    const first = laterUpdate(ANNA_MESSAGE, 200001);
    const between = laterUpdate(100005, 200002);
    const newest = laterUpdate(ANNA_MESSAGE, 200003);
    Object.assign(chatOf(first), { first_name: "Old", last_name: "Name", username: "old_name" });
    Object.assign(chatOf(between), { id: 777, first_name: "Between", type: "private" });
    Object.assign(chatOf(newest), { first_name: "New", last_name: "Name", username: "new_name" });

    const chats = parseChats(updatesAnswer([first, between, newest]));

    expect(chats, "one entry per chat").toEqual([
      { id: 5001001, kind: "private", name: "New Name", username: "new_name" },
      { id: 777, kind: "private", name: "Between", username: undefined },
    ]);
  });

  it("parseChats lists a chat of an edited message and of a my_chat_member update", () => {
    const edited = fixtureUpdate(100013);
    const memberUpdate = fixtureUpdate(TEST_GROUP_MEMBER_UPDATE);

    const chats = parseChats(updatesAnswer([memberUpdate, edited]));

    expect(
      chats?.map((chat) => chat.id),
      "ids, newest first",
    ).toEqual([5003003, -4001001]);
  });

  it("parseChats names a private chat by first name, last name and a valid username", () => {
    const chats = parseChats(updatesAnswer([fixtureUpdate(ANNA_MESSAGE)]));

    expect(chats, "the private chat").toEqual([
      { id: 5001001, kind: "private", name: "Anna Beispiel", username: "anna_example" },
    ]);
  });

  it.each([
    { name: "a dash", username: "anna-example" },
    { name: "a space", username: "anna example" },
    { name: "an at sign", username: "@anna" },
    { name: "angle brackets", username: "<b>anna</b>" },
    { name: "an empty text", username: "" },
    { name: "65 characters", username: "a".repeat(65) },
    { name: "a number", username: 42 },
  ])("parseChats drops a username with $name", ({ username }) => {
    const update = fixtureUpdate(ANNA_MESSAGE);
    chatOf(update).username = username;

    const chats = parseChats(updatesAnswer([update]));

    expect(chats, "the private chat without username").toEqual([
      { id: 5001001, kind: "private", name: "Anna Beispiel", username: undefined },
    ]);
  });

  it("parseChats keeps a username of 64 letters, digits and underscores", () => {
    const update = fixtureUpdate(ANNA_MESSAGE);
    const username = "aB3_".repeat(16);
    chatOf(update).username = username;

    const chats = parseChats(updatesAnswer([update]));

    expect(chats?.[0]?.username, "username").toBe(username);
  });

  it("parseChats skips channels, ids that are not safe integers and updates without a chat", () => {
    const channel = fixtureUpdate(ANNA_MESSAGE);
    Object.assign(chatOf(channel), { id: -1005555555555, type: "channel", title: "News" });
    const unsafe = fixtureUpdate(ANNA_MESSAGE);
    chatOf(unsafe).id = 9_007_199_254_740_992;
    const fractional = fixtureUpdate(ANNA_MESSAGE);
    chatOf(fractional).id = 1.5;
    const textual = fixtureUpdate(ANNA_MESSAGE);
    chatOf(textual).id = "5001001";
    const unknownType = fixtureUpdate(ANNA_MESSAGE);
    chatOf(unknownType).type = "sender";
    const noChat = fixtureUpdate(ANNA_MESSAGE);
    delete chatHolderOf(noChat).chat;
    const valid = fixtureUpdate(100005);

    const chats = parseChats(
      updatesAnswer([
        channel,
        unsafe,
        fractional,
        textual,
        unknownType,
        noChat,
        { update_id: 1 },
        null,
        "update",
        fixtureUpdate(100011),
        fixtureUpdate(100012),
        valid,
      ]),
    );

    expect(chats, "only the valid private chat").toEqual([
      { id: 5002002, kind: "private", name: "Bernd", username: undefined },
    ]);
  });

  it("parseChats names a chat without a name by its id", () => {
    const privateChat = fixtureUpdate(ANNA_MESSAGE);
    const group = fixtureUpdate(TEST_GROUP_MEMBER_UPDATE);
    const privateChatObject = chatOf(privateChat);
    delete privateChatObject.first_name;
    delete privateChatObject.last_name;
    delete privateChatObject.username;
    delete chatOf(group).title;

    const chats = parseChats(updatesAnswer([privateChat, group]));

    expect(chats, "chats named by their decimal id").toEqual([
      { id: -4001001, kind: "group", name: "-4001001", username: undefined },
      { id: 5001001, kind: "private", name: "5001001", username: undefined },
    ]);
  });

  it("parseChats cuts a name to 128 code points", () => {
    const astral = "\u{1F319}";
    const group = fixtureUpdate(TEST_GROUP_MEMBER_UPDATE);
    chatOf(group).title = astral.repeat(200);
    const privateChat = fixtureUpdate(ANNA_MESSAGE);
    Object.assign(chatOf(privateChat), { first_name: "a".repeat(100), last_name: "b".repeat(100) });

    const chats = parseChats(updatesAnswer([privateChat, group]));

    expect(chats?.[0]?.name, "group title").toBe(astral.repeat(MAX_CHAT_NAME_CHARACTERS));
    expect(codePoints(chats?.[0]?.name ?? ""), "code points of the group title").toBe(MAX_CHAT_NAME_CHARACTERS);
    expect(chats?.[1]?.name, "private name").toBe(`${"a".repeat(100)} ${"b".repeat(27)}`);
  });

  it("parseChats leaves out a chat whose newest update removed or blocked the bot", () => {
    const chats = parseChats(FIXTURES.getUpdates);

    expect(
      chats?.map((chat) => chat.id),
      "ids of the listed chats",
    ).not.toContain(5004004);
    expect(
      chats?.map((chat) => chat.id),
      "ids of the listed chats",
    ).not.toContain(-4002002);
  });

  it.each([
    { status: "left", listed: false },
    { status: "kicked", listed: false },
    { status: "member", listed: true },
    { status: "administrator", listed: true },
    { status: "restricted", listed: true },
  ])("parseChats treats a my_chat_member update with status $status as listed: $listed", ({ status, listed }) => {
    const update = fixtureUpdate(OLD_GROUP_LEFT);
    newChatMemberOf(update).status = status;

    const chats = parseChats(updatesAnswer([update]));

    expect(chats?.map((chat) => chat.id) ?? [], "listed ids").toEqual(listed ? [-4002002] : []);
  });

  it("parseChats lists a chat again after an update newer than its removal", () => {
    const removed = [fixtureUpdate(OLD_GROUP_MESSAGE), fixtureUpdate(OLD_GROUP_LEFT)];
    const later = laterUpdate(OLD_GROUP_MESSAGE, 100020);

    const chats = parseChats(updatesAnswer([...removed, later]));

    expect(chats, "the group is listed again").toEqual([
      { id: -4002002, kind: "group", name: "Old Group", username: undefined },
    ]);
  });

  it("parseChats leaves out a group that was migrated to a supergroup", () => {
    const chats = parseChats(updatesAnswer([fixtureUpdate(OLD_GROUP_MESSAGE), fixtureUpdate(MIGRATED_MESSAGE)]));

    expect(
      chats?.map((chat) => chat.id),
      "listed ids",
    ).toEqual([-4002002]);
  });

  it.each([
    { name: "null", body: null },
    { name: "a text", body: "ok" },
    { name: "an array", body: [] },
    { name: "an object without ok", body: { result: [] } },
    { name: "ok false", body: { ok: false, result: [] } },
    { name: "ok as a text", body: { ok: "true", result: [] } },
    { name: "ok true without a result", body: { ok: true } },
    { name: "ok true with an object as result", body: { ok: true, result: {} } },
    { name: "ok true with a text as result", body: { ok: true, result: "[]" } },
    { name: "the unauthorized fixture", body: FIXTURES.unauthorized },
    { name: "the conflict fixture", body: FIXTURES.conflict },
  ])("parseChats returns undefined for an answer that is not ok or has no result array: $name", ({ body }) => {
    const chats = parseChats(body);

    expect(chats, "result").toBeUndefined();
  });

  it("parseChats returns an empty list for an ok answer without updates", () => {
    const chats = parseChats(updatesAnswer([]));

    expect(chats, "result").toEqual([]);
  });
});

describe("findChats", () => {
  it("findChats sends one getUpdates request with offset -100, limit 100 and timeout 0", async () => {
    const telegram = telegramDouble();

    await findChats(TOKEN, telegram.fetch);

    expect(telegram.requests.length, "number of requests").toBe(1);
    const [request] = telegram.requests;
    expect(request?.method, "Bot API method").toBe("getUpdates");
    expect(request?.token, "token in the URL").toBe(TOKEN);
    expect(request?.origin, "origin").toBe("https://api.telegram.org");
    expect(request?.httpMethod, "HTTP method").toBe("POST");
    expect(request?.contentType, "Content-Type").toBe("application/json");
    expect(request?.body, "JSON body").toEqual({ offset: -100, limit: 100, timeout: 0 });
    expect(request?.signal.aborted, "abort signal not yet aborted").toBe(false);
  });

  it("findChats returns the chats of a successful answer", async () => {
    const telegram = telegramDouble();

    const result = await findChats(TOKEN, telegram.fetch);

    expect(result, "result").toEqual({ kind: "found", chats: FIXTURE_CHATS });
  });

  it("findChats returns found with no chats for an ok answer without updates", async () => {
    const telegram = telegramDouble({ getUpdates: jsonAnswer(200, updatesAnswer([])) });

    const result = await findChats(TOKEN, telegram.fetch);

    expect(result, "result").toEqual({ kind: "found", chats: [] });
  });

  it.each([{ status: 401 }, { status: 404 }])("findChats maps $status to token-rejected", async ({ status }) => {
    const telegram = telegramDouble({ getUpdates: jsonAnswer(status, FIXTURES.unauthorized) });

    const result = await findChats(TOKEN, telegram.fetch);

    expect(result, "result").toEqual({ kind: "token-rejected" });
  });

  it("findChats maps 409 to conflict", async () => {
    const telegram = telegramDouble({ getUpdates: jsonAnswer(409, FIXTURES.conflict) });

    const result = await findChats(TOKEN, telegram.fetch);

    expect(result, "result").toEqual({ kind: "conflict" });
    expect(telegram.methods(), "only getUpdates is called, no webhook is removed").toEqual(["getUpdates"]);
  });

  it.each<{ name: string; answer: TelegramAnswer }>([
    { name: "status 400", answer: jsonAnswer(400, FIXTURES.unauthorized) },
    { name: "status 403", answer: jsonAnswer(403, FIXTURES.unauthorized) },
    { name: "status 429", answer: jsonAnswer(429, { ok: false, error_code: 429, parameters: { retry_after: 3 } }) },
    { name: "status 500", answer: jsonAnswer(500, { ok: false, error_code: 500 }) },
    { name: "status 502", answer: { kind: "raw", status: 502, body: "<html>Bad Gateway</html>" } },
    { name: "a rejected fetch", answer: REJECTED },
    {
      name: "a body over 1 MiB",
      answer: { kind: "raw", status: 200, body: "x".repeat(MAX_TELEGRAM_RESPONSE_BYTES + 1) },
    },
    {
      name: "a body of 1 MiB that is not JSON",
      answer: { kind: "raw", status: 200, body: "x".repeat(MAX_TELEGRAM_RESPONSE_BYTES) },
    },
    { name: "a body that is not JSON", answer: { kind: "raw", status: 200, body: "not json" } },
    {
      name: "a body that is not UTF-8",
      answer: { kind: "raw", status: 200, body: new Uint8Array([0x7b, 0xff, 0x7d]) },
    },
    { name: "an empty body", answer: { kind: "raw", status: 200, body: null } },
    { name: "a 2xx answer with ok false", answer: jsonAnswer(200, { ok: false, result: [] }) },
    { name: "a 2xx answer without a result array", answer: jsonAnswer(200, { ok: true, result: {} }) },
    { name: "a 2xx answer that is a list", answer: jsonAnswer(200, []) },
  ])("findChats maps $name to unavailable", async ({ answer }) => {
    const telegram = telegramDouble({ getUpdates: answer });

    const result = await findChats(TOKEN, telegram.fetch);

    expect(result, "result").toEqual({ kind: "unavailable" });
  });
});

describe("sendMessage", () => {
  it("sendMessage posts chat_id and text as JSON to sendMessage", async () => {
    const telegram = telegramDouble();

    const result = await sendMessage(TOKEN, -1_001_234_567_890, "Seluna code: 123456", telegram.fetch);

    expect(result, "result").toBe("sent");
    expect(telegram.requests.length, "number of requests").toBe(1);
    const [request] = telegram.requests;
    expect(request?.method, "Bot API method").toBe("sendMessage");
    expect(request?.token, "token in the URL").toBe(TOKEN);
    expect(request?.origin, "origin").toBe("https://api.telegram.org");
    expect(request?.httpMethod, "HTTP method").toBe("POST");
    expect(request?.contentType, "Content-Type").toBe("application/json");
    expect(request?.body, "JSON body: the chat id is a number, there is no parse_mode").toEqual({
      chat_id: -1_001_234_567_890,
      text: "Seluna code: 123456",
    });
    expect(request?.signal.aborted, "abort signal not yet aborted").toBe(false);
  });

  it.each([{ status: 401 }, { status: 404 }])("sendMessage maps $status to token-rejected", async ({ status }) => {
    const telegram = telegramDouble({ sendMessage: jsonAnswer(status, FIXTURES.unauthorized) });

    const result = await sendMessage(TOKEN, 5_001_001, "text", telegram.fetch);

    expect(result, "result").toBe("token-rejected");
  });

  it.each<{ name: string; answer: TelegramAnswer }>([
    {
      name: "status 400",
      answer: jsonAnswer(400, { ok: false, error_code: 400, description: "Bad Request: chat not found" }),
    },
    {
      name: "status 403",
      answer: jsonAnswer(403, { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }),
    },
    { name: "status 409", answer: jsonAnswer(409, FIXTURES.conflict) },
    { name: "status 429", answer: jsonAnswer(429, { ok: false, error_code: 429 }) },
    { name: "status 500", answer: jsonAnswer(500, { ok: false, error_code: 500 }) },
    { name: "a rejected fetch", answer: REJECTED },
    { name: "a 2xx answer with ok false", answer: jsonAnswer(200, { ok: false }) },
    { name: "a 2xx answer without ok", answer: jsonAnswer(200, { result: {} }) },
    { name: "a 2xx answer with ok as a text", answer: jsonAnswer(200, { ok: "true" }) },
    { name: "a 2xx answer that is a list", answer: jsonAnswer(200, [{ ok: true }]) },
    { name: "a 2xx answer that is not JSON", answer: { kind: "raw", status: 200, body: "OK" } },
    {
      name: "a 2xx answer that is not UTF-8",
      answer: { kind: "raw", status: 200, body: new Uint8Array([0x7b, 0xff, 0x7d]) },
    },
    { name: "an empty 2xx answer", answer: { kind: "raw", status: 200, body: null } },
    {
      name: "a 2xx answer over 1 MiB",
      answer: { kind: "raw", status: 200, body: `{"ok":true}${" ".repeat(MAX_TELEGRAM_RESPONSE_BYTES)}` },
    },
  ])("sendMessage maps 401 and 404 to token-rejected and every other failure to failed: $name", async ({ answer }) => {
    const telegram = telegramDouble({ sendMessage: answer });

    const result = await sendMessage(TOKEN, 5_001_001, "text", telegram.fetch);

    expect(result, "result").toBe("failed");
  });
});

describe("sendNotification", () => {
  const URL_ON_GITHUB = "https://github.com/o/r/pull/7";
  const MESSAGE = { text: "<b>T</b> · o/r #7", buttonText: "Open on GitHub", buttonUrl: URL_ON_GITHUB, silent: false };
  const NO_BUTTON = { ...MESSAGE, buttonUrl: undefined };

  function retryAfter(seconds: unknown): TelegramAnswer {
    return jsonAnswer(429, { ok: false, error_code: 429, parameters: { retry_after: seconds } });
  }

  function sleepSpy() {
    return vi.fn<(milliseconds: number) => Promise<void>>(() => Promise.resolve());
  }

  it("sendNotification posts chat_id, text, parse_mode HTML, disable_notification and the inline button as JSON to sendMessage", async () => {
    const telegram = telegramDouble();

    const result = await sendNotification(TOKEN, -1_001_234_567_890, MESSAGE, telegram.fetch, sleepSpy());

    expect(result, "result").toBe("sent");
    expect(telegram.requests.length, "number of requests").toBe(1);
    const [request] = telegram.requests;
    expect(request?.method, "Bot API method").toBe("sendMessage");
    expect(request?.token, "token in the URL").toBe(TOKEN);
    expect(request?.origin, "origin").toBe("https://api.telegram.org");
    expect(request?.httpMethod, "HTTP method").toBe("POST");
    expect(request?.contentType, "Content-Type").toBe("application/json");
    expect(request?.body, "JSON body").toEqual({
      chat_id: -1_001_234_567_890,
      text: "<b>T</b> · o/r #7",
      parse_mode: "HTML",
      disable_notification: false,
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: "Open on GitHub", url: URL_ON_GITHUB }]] },
    });
    expect(request?.signal.aborted, "abort signal not yet aborted").toBe(false);
  });

  it("sendNotification sends disable_notification true and no reply_markup for a silent message without a button", async () => {
    const telegram = telegramDouble();

    const result = await sendNotification(TOKEN, 5_001_001, { ...NO_BUTTON, silent: true }, telegram.fetch, sleepSpy());

    expect(result, "result").toBe("sent");
    expect(telegram.requests[0]?.body, "JSON body").toEqual({
      chat_id: 5_001_001,
      text: "<b>T</b> · o/r #7",
      parse_mode: "HTML",
      disable_notification: true,
      link_preview_options: { is_disabled: true },
    });
  });

  it("sendNotification waits retry_after seconds and sends once more after a 429", async () => {
    const telegram = telegramDouble({ sendMessage: [retryAfter(2), jsonAnswer(200, FIXTURES.sendMessage)] });
    const sleep = sleepSpy();

    const result = await sendNotification(TOKEN, 5_001_001, MESSAGE, telegram.fetch, sleep);

    expect(result, "result").toBe("sent");
    expect(sleep.mock.calls, "sleep calls").toEqual([[2000]]);
    expect(telegram.requests.length, "number of requests").toBe(2);
    expect(telegram.requests[1]?.body, "the same request is sent again").toEqual(telegram.requests[0]?.body);
  });

  it("sendNotification waits for the retry_after of the 429 fixture", async () => {
    const telegram = telegramDouble({
      sendMessage: [jsonAnswer(429, FIXTURES.tooManyRequests), jsonAnswer(200, FIXTURES.sendMessage)],
    });
    const sleep = sleepSpy();

    const result = await sendNotification(TOKEN, 5_001_001, MESSAGE, telegram.fetch, sleep);

    expect(result, "result").toBe("sent");
    expect(sleep.mock.calls, "sleep calls").toEqual([[3000]]);
  });

  it.each<{ name: string; answer: TelegramAnswer }>([
    { name: "missing", answer: jsonAnswer(429, { ok: false, error_code: 429 }) },
    { name: "0", answer: retryAfter(0) },
    { name: "6", answer: retryAfter(6) },
    { name: "1.5", answer: retryAfter(1.5) },
    { name: 'the text "2"', answer: retryAfter("2") },
    { name: "-1", answer: retryAfter(-1) },
    { name: "in a body that is not JSON", answer: { kind: "raw", status: 429, body: "not json" } },
  ])("sendNotification returns rate-limited without waiting when retry_after is $name", async ({ answer }) => {
    const telegram = telegramDouble({ sendMessage: answer });
    const sleep = sleepSpy();

    const result = await sendNotification(TOKEN, 5_001_001, MESSAGE, telegram.fetch, sleep);

    expect(result, "result").toBe("rate-limited");
    expect(sleep, "sleep").not.toHaveBeenCalled();
    expect(telegram.requests.length, "number of requests").toBe(1);
  });

  it("sendNotification returns rate-limited after a second 429 without a second wait", async () => {
    const telegram = telegramDouble({ sendMessage: [retryAfter(1), retryAfter(1)] });
    const sleep = sleepSpy();

    const result = await sendNotification(TOKEN, 5_001_001, MESSAGE, telegram.fetch, sleep);

    expect(result, "result").toBe("rate-limited");
    expect(sleep.mock.calls, "sleep calls").toEqual([[1000]]);
    expect(telegram.requests.length, "number of requests").toBe(2);
  });

  it("sendNotification returns token-rejected for a 401 after a 429 wait", async () => {
    const telegram = telegramDouble({ sendMessage: [retryAfter(1), jsonAnswer(401, FIXTURES.unauthorized)] });
    const sleep = sleepSpy();

    const result = await sendNotification(TOKEN, 5_001_001, MESSAGE, telegram.fetch, sleep);

    expect(result, "result").toBe("token-rejected");
    expect(sleep.mock.calls, "sleep calls").toEqual([[1000]]);
  });
});

describe("parseRetryAfter", () => {
  it.each([
    { case: "a 429 body with retry_after 3", body: { ok: false, parameters: { retry_after: 3 } }, expected: 3 },
    { case: "a body with ok true", body: { ok: true, parameters: { retry_after: 3 } }, expected: undefined },
    {
      case: "a retry_after of 2 ** 53",
      body: { ok: false, parameters: { retry_after: 2 ** 53 } },
      expected: undefined,
    },
    { case: "a text", body: "retry_after", expected: undefined },
    { case: "null", body: null, expected: undefined },
    { case: "a list", body: [{ ok: false, parameters: { retry_after: 3 } }], expected: undefined },
  ])("parseRetryAfter returns $expected for $case", ({ body, expected }) => {
    const seconds = parseRetryAfter(body);

    expect(seconds, "seconds").toBe(expected);
  });
});
