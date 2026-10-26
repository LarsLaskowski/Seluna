import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { deliverMessages, wait } from "./delivery";
import type { DeliveryDeps, DeliveryLogEntry, DeliverySettings, PendingMessage } from "./delivery";
import type { ChannelList } from "./channels/channel";
import { TELEGRAM_CHANNEL } from "./channels/telegram";
import type { StoredNotification } from "./notification";
import type { Language } from "./setup/language";
import { writeSecret } from "./store/secrets";
import { DELIVERY_CHANNEL_SETTING, TELEGRAM_CHAT_ID_SETTING, writeSetting } from "./store/settings";
import { testChannel } from "../test/channel";
import { applyMigrations } from "../test/d1";
import { keyFor, withFirstCharacterChanged } from "../test/keys";
import { FIXTURES, jsonAnswer, REJECTED, telegramDouble } from "../test/telegram";
import type { TelegramAnswer, TelegramAnswers } from "../test/telegram";

const TOKEN = "123456789:AAH-throwaway_token0123456789abcdefghij";
const CHAT = 5_001_001;
const BUTTON_URL = "https://github.com/o/r/pull/7";
const OTHER_TOKEN = "987654321:BBH-other_throwaway_token0123456789abcd";
const SELUNA_SECRET = "throwaway-setup-secret-0123456789abcdef";
const SAVED_TOKEN_ENV = { SELUNA_SECRET, TELEGRAM_CHAT_ID: String(CHAT) };
const READY_ENV = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: String(CHAT) };

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM outbox"),
    env.DB.prepare("DELETE FROM settings"),
    env.DB.prepare("DELETE FROM secrets"),
    env.DB.prepare("DELETE FROM meta WHERE key = 'key_check'"),
  ]);
});

async function insertRow(
  text = "<b>T</b> · o/r #7",
  buttonUrl: string | null = null,
  silent = 0,
  attempts = 0,
): Promise<PendingMessage> {
  const row = await env.DB.prepare(
    "INSERT INTO outbox (text, button_url, silent, attempts, created_at) VALUES (?1, ?2, ?3, ?4, 1000) RETURNING id",
  )
    .bind(text, buttonUrl, silent, attempts)
    .first();
  const id = row?.id;
  if (typeof id !== "number") {
    throw new TypeError("The insert returned no id");
  }
  return { id, text, buttonUrl: buttonUrl ?? undefined, silent: silent === 1 };
}

async function stateOf(message: PendingMessage): Promise<unknown> {
  return env.DB.prepare("SELECT status, attempts FROM outbox WHERE id = ?1").bind(message.id).first();
}

const NOW = new Date("2026-10-17T12:34:00Z");

function settingsIn(language: Language): DeliverySettings {
  return { language, timeZone: "UTC", quietHours: undefined };
}

/** Settings with quiet hours 12:00-13:00 in UTC. */
function inQuietHours(): DeliverySettings {
  return { language: "en", timeZone: "UTC", quietHours: { start: "12:00", end: "13:00" } };
}

/** A clock that reads one millisecond before 13:00 UTC on its first call and 13:00 UTC on every later call. */
function boundaryClock(): () => Date {
  return vi
    .fn<() => Date>()
    .mockReturnValueOnce(new Date("2026-10-17T12:59:59.999Z"))
    .mockReturnValue(new Date("2026-10-17T13:00:00.000Z"));
}

interface Harness {
  readonly deps: DeliveryDeps;
  readonly log: DeliveryLogEntry[];
  readonly telegram: ReturnType<typeof telegramDouble>;
}

function harness(answers: TelegramAnswers = {}, deliveryEnv: object = READY_ENV, db: D1Database = env.DB): Harness {
  const telegram = telegramDouble(answers);
  const log: DeliveryLogEntry[] = [];
  const deps: DeliveryDeps = {
    env: deliveryEnv,
    db,
    fetch: telegram.fetch,
    sleep: () => Promise.resolve(),
    log: (entry) => {
      log.push(entry);
    },
    now: () => NOW,
  };
  return { deps, log, telegram };
}

/** A database that passes everything to `db` except a statement matching `failing`, for which `prepare` throws. */
function dbFailingFor(db: D1Database, failing: RegExp): D1Database {
  const unsupported = (): never => {
    throw new Error("Not supported by this wrapper");
  };
  return {
    prepare: (query: string) => {
      if (failing.test(query)) {
        throw new Error("The database failed");
      }
      return db.prepare(query);
    },
    batch: unsupported,
    exec: unsupported,
    dump: unsupported,
    withSession: unsupported,
  };
}

function retryAfter(seconds: number): TelegramAnswer {
  return jsonAnswer(429, { ok: false, error_code: 429, parameters: { retry_after: seconds } });
}

describe("deliverMessages", () => {
  it.each<{ case: string; answer: TelegramAnswer | readonly TelegramAnswer[]; result: string }>([
    { case: "answers 500", answer: jsonAnswer(500, { ok: false, error_code: 500 }), result: "failed" },
    { case: "answers 400 with ok false", answer: jsonAnswer(400, { ok: false, error_code: 400 }), result: "failed" },
    { case: "answers 200 with ok false", answer: jsonAnswer(200, { ok: false }), result: "failed" },
    { case: "rejects", answer: REJECTED, result: "failed" },
    { case: "answers 401", answer: jsonAnswer(401, FIXTURES.unauthorized), result: "token-rejected" },
    { case: "answers 404", answer: jsonAnswer(404, FIXTURES.unauthorized), result: "token-rejected" },
    {
      case: "answers 429 without parameters",
      answer: jsonAnswer(429, { ok: false, error_code: 429 }),
      result: "rate-limited",
    },
    { case: "answers 429 with retry_after 6", answer: retryAfter(6), result: "rate-limited" },
    { case: "answers 429 twice", answer: [retryAfter(1), retryAfter(1)], result: "rate-limited" },
  ])(
    "deliverMessages leaves the row pending with attempts 1 and logs $result when sendMessage $case",
    async ({ answer, result }) => {
      const message = await insertRow();
      const { deps, log } = harness({ sendMessage: answer });

      await deliverMessages([message], settingsIn("en"), deps);

      expect(await stateOf(message), "row").toEqual({ status: "pending", attempts: 1 });
      expect(log, "log entries").toEqual([{ outbox: message.id, result }]);
    },
  );

  it("deliverMessages marks the row sent with attempts 1 after a successful answer", async () => {
    const message = await insertRow();
    const { deps, telegram } = harness();

    await deliverMessages([message], settingsIn("en"), deps);

    expect(await stateOf(message), "row").toEqual({ status: "sent", attempts: 1 });
    expect(telegram.requests.length, "number of requests").toBe(1);
    expect(telegram.requests[0]?.body, "request body").toEqual({
      chat_id: CHAT,
      text: "<b>T</b> · o/r #7",
      parse_mode: "HTML",
      disable_notification: false,
      link_preview_options: { is_disabled: true },
    });
  });

  it("deliverMessages sends the next row after a failing one", async () => {
    const first = await insertRow("first");
    const second = await insertRow("second");
    const { deps } = harness({ sendMessage: [jsonAnswer(500, { ok: false }), jsonAnswer(200, FIXTURES.sendMessage)] });

    await deliverMessages([first, second], settingsIn("en"), deps);

    expect(await stateOf(first), "first row").toEqual({ status: "pending", attempts: 1 });
    expect(await stateOf(second), "second row").toEqual({ status: "sent", attempts: 1 });
  });

  it.each<{ language: Language; label: string }>([
    { language: "en", label: "Open on GitHub" },
    { language: "de", label: "Auf GitHub öffnen" },
  ])("deliverMessages labels the button $label for language $language", async ({ language, label }) => {
    const message = await insertRow("text", BUTTON_URL);
    const { deps, telegram } = harness();

    await deliverMessages([message], settingsIn(language), deps);

    expect(telegram.requests[0]?.body, "request body").toMatchObject({
      reply_markup: { inline_keyboard: [[{ text: label, url: BUTTON_URL }]] },
    });
  });

  it("deliverMessages sends no reply_markup for a row without a button URL", async () => {
    const message = await insertRow("text", null);
    const { deps, telegram } = harness();

    await deliverMessages([message], settingsIn("de"), deps);

    expect(telegram.requests.length, "number of requests").toBe(1);
    expect(telegram.requests[0]?.body, "request body").not.toHaveProperty("reply_markup");
  });

  it("deliverMessages sends to TELEGRAM_CHAT_ID over the stored chat", async () => {
    await writeSetting(env.DB, TELEGRAM_CHAT_ID_SETTING, "111");
    const message = await insertRow();
    const { deps, telegram } = harness({}, { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "222" });

    await deliverMessages([message], settingsIn("en"), deps);

    expect(telegram.requests[0]?.body, "request body").toMatchObject({ chat_id: 222 });
  });

  it("deliverMessages sends to the stored telegram_chat_id without the Worker secret", async () => {
    await writeSetting(env.DB, TELEGRAM_CHAT_ID_SETTING, "111");
    const message = await insertRow();
    const { deps, telegram } = harness({}, { TELEGRAM_BOT_TOKEN: TOKEN });

    await deliverMessages([message], settingsIn("en"), deps);

    expect(telegram.requests[0]?.body, "request body").toMatchObject({ chat_id: 111 });
  });

  it.each<{ case: string; result: string; deliveryEnv: object; storedChat: string | undefined }>([
    {
      case: "TELEGRAM_CHAT_ID is not a chat id although a chat is stored",
      result: "no-chat",
      deliveryEnv: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "abc" },
      storedChat: "111",
    },
    {
      case: "no chat is configured",
      result: "no-chat",
      deliveryEnv: { TELEGRAM_BOT_TOKEN: TOKEN },
      storedChat: undefined,
    },
    { case: "the stored chat is 0", result: "no-chat", deliveryEnv: { TELEGRAM_BOT_TOKEN: TOKEN }, storedChat: "0" },
    {
      case: "there is no bot token",
      result: "no-token",
      deliveryEnv: { TELEGRAM_CHAT_ID: "222" },
      storedChat: undefined,
    },
    {
      case: "the bot token is malformed",
      result: "no-token",
      deliveryEnv: { TELEGRAM_BOT_TOKEN: "x", TELEGRAM_CHAT_ID: "222" },
      storedChat: undefined,
    },
  ])(
    "deliverMessages calls no Telegram, keeps the row pending with attempts 0 and logs $result when $case",
    async ({ result, deliveryEnv, storedChat }) => {
      if (storedChat !== undefined) {
        await writeSetting(env.DB, TELEGRAM_CHAT_ID_SETTING, storedChat);
      }
      const message = await insertRow();
      const { deps, log, telegram } = harness({}, deliveryEnv);

      await deliverMessages([message], settingsIn("en"), deps);

      expect(telegram.requests.length, "number of requests").toBe(0);
      expect(await stateOf(message), "row").toEqual({ status: "pending", attempts: 0 });
      expect(log, "log entries").toEqual([{ outbox: message.id, result }]);
    },
  );

  it("deliverMessages sets disable_notification for a silent row", async () => {
    const message = await insertRow("quiet", null, 1);
    const { deps, telegram } = harness();

    await deliverMessages([message], settingsIn("en"), deps);

    expect(telegram.requests[0]?.body, "request body").toMatchObject({ disable_notification: true });
  });

  it("deliverMessages sends disable_notification true for a row sent during quiet hours", async () => {
    const message = await insertRow();
    const { deps, telegram } = harness();

    await deliverMessages([message], inQuietHours(), deps);

    expect(telegram.requests[0]?.body, "request body").toMatchObject({ disable_notification: true });
  });

  it("deliverMessages sends disable_notification false for a row sent outside quiet hours", async () => {
    const message = await insertRow();
    const { deps, telegram } = harness();

    await deliverMessages([message], inQuietHours(), { ...deps, now: () => new Date("2026-10-17T13:00:00Z") });

    expect(telegram.requests[0]?.body, "request body").toMatchObject({ disable_notification: false });
  });

  it("deliverMessages sends disable_notification false when quiet hours are off", async () => {
    const message = await insertRow();
    const { deps, telegram } = harness();

    await deliverMessages([message], settingsIn("en"), deps);

    expect(telegram.requests[0]?.body, "request body").toMatchObject({ disable_notification: false });
  });

  it("deliverMessages decides each row by a clock reading taken before its send", async () => {
    const first = await insertRow("first");
    const second = await insertRow("second");
    const { deps, telegram } = harness();

    await deliverMessages([first, second], inQuietHours(), { ...deps, now: boundaryClock() });

    expect(
      telegram.requests.map((request) => request.body),
      "request bodies",
    ).toMatchObject([{ disable_notification: true }, { disable_notification: false }]);
  });

  it("deliverMessages keeps disable_notification for the resend after a 429", async () => {
    const message = await insertRow();
    const { deps, telegram } = harness({ sendMessage: [retryAfter(1), jsonAnswer(200, FIXTURES.sendMessage)] });

    await deliverMessages([message], inQuietHours(), { ...deps, now: boundaryClock() });

    expect(
      telegram.requests.map((request) => request.body),
      "request bodies",
    ).toMatchObject([{ disable_notification: true }, { disable_notification: true }]);
  });

  it("deliverMessages sends a silent row without sound outside quiet hours", async () => {
    const message = await insertRow("quiet", null, 1);
    const { deps, telegram } = harness();

    await deliverMessages([message], inQuietHours(), { ...deps, now: () => new Date("2026-10-17T15:00:00Z") });

    expect(telegram.requests[0]?.body, "request body").toMatchObject({ disable_notification: true });
  });

  it("deliverMessages still sends the row when the clock throws", async () => {
    const message = await insertRow();
    const { deps, telegram } = harness();
    const failingClock = (): Date => {
      throw new Error("The clock failed");
    };

    await expect(
      deliverMessages([message], inQuietHours(), { ...deps, now: failingClock }),
      "deliverMessages settles",
    ).resolves.toBeUndefined();

    expect(telegram.requests.length, "number of requests").toBe(1);
    expect(await stateOf(message), "row").toEqual({ status: "sent", attempts: 1 });
  });

  it("deliverMessages logs store-failed and calls no Telegram when the chat cannot be read", async () => {
    const message = await insertRow();
    const { deps, log, telegram } = harness({}, { TELEGRAM_BOT_TOKEN: TOKEN }, dbFailingFor(env.DB, /settings/));

    await deliverMessages([message], settingsIn("en"), deps);

    expect(log, "log entries").toEqual([{ outbox: message.id, result: "store-failed" }]);
    expect(telegram.requests.length, "number of requests").toBe(0);
  });

  it("deliverMessages logs store-failed when the row cannot be updated", async () => {
    const message = await insertRow();
    const { deps, log, telegram } = harness({}, READY_ENV, dbFailingFor(env.DB, /UPDATE/i));

    await deliverMessages([message], settingsIn("en"), deps);

    expect(telegram.requests.length, "the message was sent once").toBe(1);
    expect(log, "log entries").toEqual([{ outbox: message.id, result: "store-failed" }]);
    expect(await stateOf(message), "row").toEqual({ status: "pending", attempts: 0 });
  });

  it("deliverMessages logs exactly the row id and the result", async () => {
    const message = await insertRow();
    const { deps, log } = harness();

    await deliverMessages([message], settingsIn("en"), deps);

    expect(log, "log entries").toEqual([{ outbox: message.id, result: "sent" }]);
  });
});

describe("wait", () => {
  it("wait resolves after the given milliseconds", async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    let state = "pending";
    const waiting = wait(2000).then(
      () => {
        state = "resolved";
      },
      () => {
        state = "rejected";
      },
    );

    await vi.advanceTimersByTimeAsync(1999);
    const before = state;
    await vi.advanceTimersByTimeAsync(1);
    await waiting;

    expect(before, "state after 1999 ms").toBe("pending");
    expect(state, "state after 2000 ms").toBe("resolved");
  });
});

describe("deliverMessages and the fifth attempt", () => {
  it.each<{ case: string; answer: TelegramAnswer; result: string }>([
    { case: "answers 500", answer: jsonAnswer(500, { ok: false, error_code: 500 }), result: "failed" },
    { case: "answers 401", answer: jsonAnswer(401, FIXTURES.unauthorized), result: "token-rejected" },
    { case: "answers 429", answer: jsonAnswer(429, { ok: false, error_code: 429 }), result: "rate-limited" },
  ])(
    "deliverMessages marks a row with 4 attempts failed and logs its marking after $result when sendMessage $case",
    async ({ answer, result }) => {
      const message = await insertRow("<b>T</b>", null, 0, 4);
      const { deps, log } = harness({ sendMessage: answer });

      await deliverMessages([message], settingsIn("en"), deps);

      expect(await stateOf(message), "row").toEqual({ status: "failed", attempts: 5 });
      expect(log, "log entries").toEqual([
        { outbox: message.id, result },
        { outbox: message.id, status: "failed" },
      ]);
    },
  );

  it("deliverMessages keeps a row with 3 attempts pending after a failed send and logs no marking", async () => {
    const message = await insertRow("<b>T</b>", null, 0, 3);
    const { deps, log } = harness({ sendMessage: jsonAnswer(500, { ok: false, error_code: 500 }) });

    await deliverMessages([message], settingsIn("en"), deps);

    expect(await stateOf(message), "row").toEqual({ status: "pending", attempts: 4 });
    expect(log, "log entries").toEqual([{ outbox: message.id, result: "failed" }]);
  });

  it("deliverMessages logs the marking of the exhausted row and goes on with the next row", async () => {
    const exhausted = await insertRow("first", null, 0, 4);
    const next = await insertRow("second");
    const { deps, log } = harness({
      sendMessage: [jsonAnswer(500, { ok: false }), jsonAnswer(200, FIXTURES.sendMessage)],
    });

    await deliverMessages([exhausted, next], settingsIn("en"), deps);

    expect(log, "log entries").toEqual([
      { outbox: exhausted.id, result: "failed" },
      { outbox: exhausted.id, status: "failed" },
      { outbox: next.id, result: "sent" },
    ]);
  });
});

async function saveToken(value: string, secret: string = SELUNA_SECRET): Promise<void> {
  const result = await writeSecret(env.DB, await keyFor(secret), "telegram_bot_token", value);
  expect(result, "seeding the saved token").toEqual({ kind: "ok" });
}

describe("deliverMessages with a saved bot token", () => {
  it("deliverMessages sends with the saved token when TELEGRAM_BOT_TOKEN is not set", async () => {
    await saveToken(OTHER_TOKEN);
    const message = await insertRow();
    const { deps, log, telegram } = harness({}, SAVED_TOKEN_ENV);

    await deliverMessages([message], settingsIn("en"), deps);

    expect(
      telegram.requests.map((request) => request.token),
      "tokens in the URLs",
    ).toEqual([OTHER_TOKEN]);
    expect(await stateOf(message), "row").toEqual({ status: "sent", attempts: 1 });
    expect(log, "log entries").toEqual([{ outbox: message.id, result: "sent" }]);
  });

  it("deliverMessages sends every row of a batch with the saved token", async () => {
    await saveToken(OTHER_TOKEN);
    const first = await insertRow("first");
    const second = await insertRow("second");
    const { deps, telegram } = harness({}, SAVED_TOKEN_ENV);

    await deliverMessages([first, second], settingsIn("en"), deps);

    expect(
      telegram.requests.map((request) => request.token),
      "tokens in the URLs",
    ).toEqual([OTHER_TOKEN, OTHER_TOKEN]);
  });

  it("deliverMessages calls no Telegram, keeps the row pending with attempts 0 and logs no-token when SELUNA_SECRET is set and no token is saved", async () => {
    const message = await insertRow();
    const { deps, log, telegram } = harness({}, SAVED_TOKEN_ENV);

    await deliverMessages([message], settingsIn("en"), deps);

    expect(telegram.requests.length, "number of requests").toBe(0);
    expect(await stateOf(message), "row").toEqual({ status: "pending", attempts: 0 });
    expect(log, "log entries").toEqual([{ outbox: message.id, result: "no-token" }]);
  });

  it("deliverMessages logs store-failed and calls no Telegram when the saved token cannot be read from D1", async () => {
    await saveToken(OTHER_TOKEN);
    const message = await insertRow();
    const { deps, log, telegram } = harness({}, SAVED_TOKEN_ENV, dbFailingFor(env.DB, /secrets/));

    await deliverMessages([message], settingsIn("en"), deps);

    expect(telegram.requests.length, "number of requests").toBe(0);
    expect(await stateOf(message), "row").toEqual({ status: "pending", attempts: 0 });
    expect(log, "log entries").toEqual([{ outbox: message.id, result: "store-failed" }]);
  });

  it("deliverMessages uses TELEGRAM_BOT_TOKEN over a saved token", async () => {
    await saveToken(OTHER_TOKEN);
    const message = await insertRow();
    const { deps, telegram } = harness({}, { ...SAVED_TOKEN_ENV, TELEGRAM_BOT_TOKEN: TOKEN });

    await deliverMessages([message], settingsIn("en"), deps);

    expect(
      telegram.requests.map((request) => request.token),
      "tokens in the URLs",
    ).toEqual([TOKEN]);
    expect(await stateOf(message), "row").toEqual({ status: "sent", attempts: 1 });
  });

  it("deliverMessages logs no-token for a malformed TELEGRAM_BOT_TOKEN without falling back to a saved token", async () => {
    await saveToken(OTHER_TOKEN);
    const message = await insertRow();
    const { deps, log, telegram } = harness({}, { ...SAVED_TOKEN_ENV, TELEGRAM_BOT_TOKEN: "1:a/../setWebhook" });

    await deliverMessages([message], settingsIn("en"), deps);

    expect(telegram.requests.length, "number of requests").toBe(0);
    expect(await stateOf(message), "row").toEqual({ status: "pending", attempts: 0 });
    expect(log, "log entries").toEqual([{ outbox: message.id, result: "no-token" }]);
  });

  it.each<{ case: string; arrange: () => Promise<void> }>([
    {
      case: "was saved under another SELUNA_SECRET",
      arrange: () => saveToken(OTHER_TOKEN, "another-throwaway-secret-fedcba9876543210"),
    },
    {
      case: "has a damaged row",
      arrange: async () => {
        await saveToken(OTHER_TOKEN);
        const row = await env.DB.prepare("SELECT ciphertext FROM secrets WHERE key = 'telegram_bot_token'").first();
        const ciphertext = typeof row?.ciphertext === "string" ? row.ciphertext : "";
        await env.DB.prepare("UPDATE secrets SET ciphertext = ?1 WHERE key = 'telegram_bot_token'")
          .bind(withFirstCharacterChanged(ciphertext))
          .run();
      },
    },
    { case: "holds a value outside the bot token form", arrange: () => saveToken("1:a/../setWebhook") },
  ])("deliverMessages logs no-token when the saved token $case", async ({ arrange }) => {
    await arrange();
    const message = await insertRow();
    const { deps, log, telegram } = harness({}, SAVED_TOKEN_ENV);

    await deliverMessages([message], settingsIn("en"), deps);

    expect(telegram.requests.length, "number of requests").toBe(0);
    expect(await stateOf(message), "row").toEqual({ status: "pending", attempts: 0 });
    expect(log, "log entries").toEqual([{ outbox: message.id, result: "no-token" }]);
  });
});

const NOTIFICATION: StoredNotification = {
  title: "New pull request",
  repository: "octo/repo",
  number: 7,
  subject: "Fix <b> & </b>",
  context: "main",
};
const NOTIFICATION_JSON =
  '{"title":"New pull request","repository":"octo/repo","number":7,"subject":"Fix <b> & </b>","context":"main"}';
const OLD_FORM_TEXT = "<b>New pull request</b> · octo/repo #7\nFix &lt;b&gt; &amp; &lt;/b&gt;\nmain";

/** Inserts a row of the new form and returns it as `readDueRows` or the webhook hands it over. */
async function insertNewRow(
  notification: StoredNotification = NOTIFICATION,
  buttonUrl: string | null = BUTTON_URL,
  attempts = 0,
): Promise<PendingMessage> {
  const row = await insertRow(JSON.stringify(notification), buttonUrl, 0, attempts);
  return { ...row, notification };
}

/** The deps of `harness` with the registered channels `channels`. */
function harnessWith(
  channels: ChannelList,
  answers: TelegramAnswers = {},
  deliveryEnv: object = READY_ENV,
  db: D1Database = env.DB,
): Harness {
  const base = harness(answers, deliveryEnv, db);
  return { ...base, deps: { ...base.deps, channels } };
}

describe("deliverMessages through the active channel", () => {
  it("deliverMessages sends through the active test channel and not through Telegram", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");
    const channel = testChannel();
    const message = await insertNewRow();
    const { deps, log, telegram } = harnessWith([TELEGRAM_CHANNEL, channel]);

    await deliverMessages([message], settingsIn("de"), deps);

    expect(telegram.requests.length, "Telegram requests").toBe(0);
    expect(channel.sends.length, "sends through the test channel").toBe(1);
    expect(channel.sends[0]?.message, "message").toEqual({
      content: { kind: "notification", notification: NOTIFICATION },
      buttonUrl: BUTTON_URL,
    });
    expect(channel.sends[0]?.options, "options").toEqual({
      silent: false,
      buttonLabel: "Auf GitHub öffnen",
      outboxId: message.id,
    });
    expect(await stateOf(message), "row").toEqual({ status: "sent", attempts: 1 });
    expect(log, "log entries").toEqual([{ outbox: message.id, result: "sent" }]);
  });

  it("deliverMessages sends through Telegram when the active channel is telegram and a test channel is registered", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "telegram");
    const channel = testChannel();
    const message = await insertNewRow();
    const { deps, telegram } = harnessWith([TELEGRAM_CHANNEL, channel]);

    await deliverMessages([message], settingsIn("en"), deps);

    expect(channel.sends.length, "sends through the test channel").toBe(0);
    expect(telegram.requests[0]?.body, "JSON body").toMatchObject({
      text: "<b>New pull request</b> · octo/repo #7\nFix &lt;b&gt; &amp; &lt;/b&gt;\nmain",
      parse_mode: "HTML",
    });
  });

  it("deliverMessages sends through Telegram when the stored channel names no registered channel", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "gone");
    const channel = testChannel();
    const message = await insertNewRow();
    const { deps, telegram } = harnessWith([channel, TELEGRAM_CHANNEL]);

    await deliverMessages([message], settingsIn("en"), deps);

    expect(channel.sends.length, "sends through the test channel").toBe(0);
    expect(telegram.requests.length, "Telegram requests").toBe(1);
    expect(telegram.requests[0]?.body, "JSON body").toMatchObject({
      text: "<b>New pull request</b> · octo/repo #7\nFix &lt;b&gt; &amp; &lt;/b&gt;\nmain",
    });
  });

  it("deliverMessages passes the silent flag, the quiet hours and the button label of the language at sending", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");
    const channel = testChannel();
    const message = await insertNewRow();
    const { deps } = harnessWith([TELEGRAM_CHANNEL, channel]);

    await deliverMessages([message], inQuietHours(), deps);

    expect(channel.sends[0]?.options, "options").toEqual({
      silent: true,
      buttonLabel: "Open on GitHub",
      outboxId: message.id,
    });
  });

  it("deliverMessages resolves the active channel once for a batch of two rows", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");
    const channel = testChannel();
    const first = await insertNewRow();
    const second = await insertNewRow();
    const { deps } = harnessWith([TELEGRAM_CHANNEL, channel]);

    await deliverMessages([first, second], settingsIn("en"), deps);

    expect(channel.prepareCalls(), "prepare calls").toBe(1);
    expect(channel.sends.length, "sends").toBe(2);
  });

  it("deliverMessages keeps the channel it resolved for the whole batch when the setting changes during it", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "first");
    const second = testChannel({ id: "second" });
    const first = testChannel({
      id: "first",
      onSend: () => writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "second"),
    });
    const one = await insertNewRow();
    const two = await insertNewRow();
    const { deps, telegram } = harnessWith([TELEGRAM_CHANNEL, first, second]);

    await deliverMessages([one, two], settingsIn("en"), deps);

    expect(first.sends.length, "sends through the channel the batch started with").toBe(2);
    expect(second.sends.length, "sends through the channel switched to").toBe(0);
    expect(telegram.requests.length, "Telegram requests").toBe(0);
  });

  it("deliverMessages sends the next batch through the channel switched to", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "first");
    const second = testChannel({ id: "second" });
    const first = testChannel({ id: "first" });
    const one = await insertNewRow();
    const two = await insertNewRow();
    const channels: ChannelList = [TELEGRAM_CHANNEL, first, second];
    const { deps } = harnessWith(channels);
    await deliverMessages([one], settingsIn("en"), deps);
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "second");

    await deliverMessages([two], settingsIn("en"), deps);

    expect(first.sends.length, "sends through the first channel").toBe(1);
    expect(second.sends.length, "sends through the second channel").toBe(1);
  });

  it("deliverMessages keeps a row's attempts across a switch and counts the next one", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");
    const channel = testChannel({ sendResult: "failed" });
    const message = await insertNewRow(NOTIFICATION, BUTTON_URL, 2);
    const { deps, log } = harnessWith([TELEGRAM_CHANNEL, channel]);

    await deliverMessages([message], settingsIn("en"), deps);

    expect(await stateOf(message), "row").toEqual({ status: "pending", attempts: 3 });
    expect(log, "log entries").toEqual([{ outbox: message.id, result: "failed" }]);
  });

  it("deliverMessages marks a row with 2 earlier attempts sent through the other channel with attempts 3", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");
    const channel = testChannel();
    const message = await insertNewRow(NOTIFICATION, BUTTON_URL, 2);
    const { deps } = harnessWith([TELEGRAM_CHANNEL, channel]);

    await deliverMessages([message], settingsIn("en"), deps);

    expect(channel.sends.length, "sends through the test channel").toBe(1);
    expect(await stateOf(message), "row").toEqual({ status: "sent", attempts: 3 });
  });

  it("deliverMessages marks the row failed after the fifth attempt through the test channel", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");
    const channel = testChannel({ sendResult: "failed" });
    const message = await insertNewRow(NOTIFICATION, BUTTON_URL, 4);
    const { deps, log } = harnessWith([TELEGRAM_CHANNEL, channel]);

    await deliverMessages([message], settingsIn("en"), deps);

    expect(await stateOf(message), "row").toEqual({ status: "failed", attempts: 5 });
    expect(log, "log entries").toEqual([
      { outbox: message.id, result: "failed" },
      { outbox: message.id, status: "failed" },
    ]);
  });

  it.each<{ sent: "rejected" | "rate-limited" | "failed"; logged: string }>([
    { sent: "rejected", logged: "token-rejected" },
    { sent: "rate-limited", logged: "rate-limited" },
    { sent: "failed", logged: "failed" },
  ])("deliverMessages logs $logged and counts an attempt when the channel answers $sent", async ({ sent, logged }) => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");
    const channel = testChannel({ sendResult: sent });
    const message = await insertNewRow();
    const { deps, log } = harnessWith([TELEGRAM_CHANNEL, channel]);

    await deliverMessages([message], settingsIn("en"), deps);

    expect(await stateOf(message), "row").toEqual({ status: "pending", attempts: 1 });
    expect(log, "log entries").toEqual([{ outbox: message.id, result: logged }]);
  });

  it("deliverMessages logs store-failed and calls no channel when the active channel cannot be read", async () => {
    const channel = testChannel();
    const message = await insertNewRow();
    const { deps, log, telegram } = harnessWith(
      [channel, TELEGRAM_CHANNEL],
      {},
      READY_ENV,
      dbFailingFor(env.DB, /settings/),
    );

    await deliverMessages([message], settingsIn("en"), deps);

    expect(channel.sends.length, "sends").toBe(0);
    expect(telegram.requests.length, "Telegram requests").toBe(0);
    expect(await stateOf(message), "row").toEqual({ status: "pending", attempts: 0 });
    expect(log, "log entries").toEqual([{ outbox: message.id, result: "store-failed" }]);
  });
});

describe("deliverMessages and the active channel that is not ready", () => {
  it.each<{ case: string; unavailable: "no-token" | "no-chat" }>([
    { case: "has no credentials", unavailable: "no-token" },
    { case: "has no destination", unavailable: "no-chat" },
  ])(
    "deliverMessages calls no channel, keeps attempts and logs $unavailable while a test channel $case, beside a ready Telegram",
    async ({ unavailable }) => {
      await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");
      const channel = testChannel({ configured: false, unavailable });
      const message = await insertNewRow(NOTIFICATION, BUTTON_URL, 2);
      const { deps, log, telegram } = harnessWith([TELEGRAM_CHANNEL, channel]);

      await deliverMessages([message], settingsIn("en"), deps);

      expect(channel.sends.length, "sends").toBe(0);
      expect(telegram.requests.length, "Telegram requests: no fallback to another channel").toBe(0);
      expect(await stateOf(message), "row").toEqual({ status: "pending", attempts: 2 });
      expect(log, "log entries").toEqual([{ outbox: message.id, result: unavailable }]);
    },
  );

  it("deliverMessages leaves a damaged row's attempts unchanged while the active channel is not ready", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");
    const channel = testChannel({ configured: false });
    const row = await insertRow("{not json", null, 0, 1);
    const damaged: PendingMessage = { ...row, notification: "damaged" };
    const { deps, log } = harnessWith([TELEGRAM_CHANNEL, channel]);

    await deliverMessages([damaged], settingsIn("en"), deps);

    expect(await stateOf(damaged), "row").toEqual({ status: "pending", attempts: 1 });
    expect(log, "log entries").toEqual([{ outbox: damaged.id, result: "no-token" }]);
  });
});

describe("deliverMessages and damaged rows", () => {
  it("deliverMessages counts a failed attempt for a damaged row, calls no channel and still sends the next row", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");
    const channel = testChannel();
    const row = await insertRow("{not json");
    const damaged: PendingMessage = { ...row, notification: "damaged" };
    const next = await insertNewRow();
    const { deps, log, telegram } = harnessWith([TELEGRAM_CHANNEL, channel]);

    await deliverMessages([damaged, next], settingsIn("en"), deps);

    expect(channel.sends.length, "sends: only the readable row").toBe(1);
    expect(channel.sends[0]?.options.outboxId, "the row sent").toBe(next.id);
    expect(telegram.requests.length, "Telegram requests").toBe(0);
    expect(await stateOf(damaged), "damaged row").toEqual({ status: "pending", attempts: 1 });
    expect(await stateOf(next), "next row").toEqual({ status: "sent", attempts: 1 });
    expect(log, "log entries").toEqual([
      { outbox: damaged.id, result: "failed" },
      { outbox: next.id, result: "sent" },
    ]);
  });

  it("deliverMessages counts a failed attempt for a damaged row through Telegram without a Telegram request", async () => {
    const row = await insertRow("{not json");
    const damaged: PendingMessage = { ...row, notification: "damaged" };
    const next = await insertRow();
    const { deps, telegram } = harness();

    await deliverMessages([damaged, next], settingsIn("en"), deps);

    expect(telegram.requests.length, "Telegram requests: only the next row").toBe(1);
    expect(await stateOf(damaged), "damaged row").toEqual({ status: "pending", attempts: 1 });
    expect(await stateOf(next), "next row").toEqual({ status: "sent", attempts: 1 });
  });

  it("deliverMessages marks a damaged row with 4 attempts failed on the fifth and logs the marking", async () => {
    const row = await insertRow("{not json", null, 0, 4);
    const damaged: PendingMessage = { ...row, notification: "damaged" };
    const { deps, log, telegram } = harness();

    await deliverMessages([damaged], settingsIn("en"), deps);

    expect(telegram.requests.length, "Telegram requests").toBe(0);
    expect(await stateOf(damaged), "row").toEqual({ status: "failed", attempts: 5 });
    expect(log, "log entries").toEqual([
      { outbox: damaged.id, result: "failed" },
      { outbox: damaged.id, status: "failed" },
    ]);
  });

  it("deliverMessages sends a row without a notification whose text is not JSON as the stored text", async () => {
    const message = await insertRow(OLD_FORM_TEXT, BUTTON_URL);
    const channel = testChannel();
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");
    const { deps } = harnessWith([TELEGRAM_CHANNEL, channel]);

    await deliverMessages([message], settingsIn("en"), deps);

    expect(channel.sends[0]?.message.content, "content").toEqual({ kind: "legacy", text: OLD_FORM_TEXT });
  });

  it("deliverMessages decodes a row without a notification whose text starts with { and never sends the raw JSON", async () => {
    const message = await insertRow(NOTIFICATION_JSON, BUTTON_URL);
    const { deps, telegram } = harness();

    await deliverMessages([message], settingsIn("en"), deps);

    expect(telegram.requests.length, "Telegram requests").toBe(1);
    expect(telegram.requests[0]?.body, "JSON body").toMatchObject({
      text: "<b>New pull request</b> · octo/repo #7\nFix &lt;b&gt; &amp; &lt;/b&gt;\nmain",
      parse_mode: "HTML",
    });
    expect(await stateOf(message), "row").toEqual({ status: "sent", attempts: 1 });
  });

  it("deliverMessages hands a row without a notification whose text starts with { to a test channel as a notification", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");
    const channel = testChannel();
    const message = await insertRow(NOTIFICATION_JSON, BUTTON_URL);
    const { deps } = harnessWith([TELEGRAM_CHANNEL, channel]);

    await deliverMessages([message], settingsIn("en"), deps);

    expect(channel.sends[0]?.message.content, "content").toEqual({ kind: "notification", notification: NOTIFICATION });
  });

  it.each([
    { case: "invalid JSON", text: "{not json" },
    { case: "another shape", text: '{"title":1}' },
  ])(
    "deliverMessages marks a row without a notification as damaged and sends no raw JSON when its text starts with { and holds $case",
    async ({ text }) => {
      const message = await insertRow(text);
      const { deps, log, telegram } = harness();

      await deliverMessages([message], settingsIn("en"), deps);

      expect(telegram.requests.length, "Telegram requests").toBe(0);
      expect(await stateOf(message), "row").toEqual({ status: "pending", attempts: 1 });
      expect(log, "log entries").toEqual([{ outbox: message.id, result: "failed" }]);
    },
  );
});

describe("deliverMessages and old-form rows reaching another channel", () => {
  it("deliverMessages hands a test channel the title, repository, number, lines and button an old row's text holds", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");
    const channel = testChannel();
    const message = await insertRow(OLD_FORM_TEXT, BUTTON_URL);
    const { deps } = harnessWith([TELEGRAM_CHANNEL, channel]);

    await deliverMessages([message], settingsIn("en"), deps);

    expect(channel.sends[0]?.notification, "notification the channel read").toEqual(NOTIFICATION);
    expect(channel.sends[0]?.message.buttonUrl, "button URL").toBe(BUTTON_URL);
    expect(await stateOf(message), "row").toEqual({ status: "sent", attempts: 1 });
  });

  it("deliverMessages counts a failed attempt when a channel gets an old row whose text it cannot read", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");
    const channel = testChannel();
    const message = await insertRow("t");
    const next = await insertNewRow();
    const { deps, log } = harnessWith([TELEGRAM_CHANNEL, channel]);

    await deliverMessages([message, next], settingsIn("en"), deps);

    expect(channel.sends.length, "sends reached the channel").toBe(2);
    expect(channel.sends[0]?.notification, "notification read from the unreadable row").toBeUndefined();
    expect(await stateOf(message), "unreadable row").toEqual({ status: "pending", attempts: 1 });
    expect(await stateOf(next), "next row").toEqual({ status: "sent", attempts: 1 });
    expect(log, "log entries").toEqual([
      { outbox: message.id, result: "failed" },
      { outbox: next.id, result: "sent" },
    ]);
  });
});
