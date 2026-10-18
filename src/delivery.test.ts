import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { deliverMessages, wait } from "./delivery";
import type { DeliveryDeps, DeliveryLogEntry, DeliverySettings, PendingMessage } from "./delivery";
import type { Language } from "./setup/language";
import { TELEGRAM_CHAT_ID_SETTING, writeSetting } from "./store/settings";
import { applyMigrations } from "../test/d1";
import { FIXTURES, jsonAnswer, REJECTED, telegramDouble } from "../test/telegram";
import type { TelegramAnswer, TelegramAnswers } from "../test/telegram";

const TOKEN = "123456789:AAH-throwaway_token0123456789abcdefghij";
const CHAT = 5_001_001;
const BUTTON_URL = "https://github.com/o/r/pull/7";
const READY_ENV = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: String(CHAT) };

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([env.DB.prepare("DELETE FROM outbox"), env.DB.prepare("DELETE FROM settings")]);
});

async function insertRow(
  text = "<b>T</b> · o/r #7",
  buttonUrl: string | null = null,
  silent = 0,
): Promise<PendingMessage> {
  const row = await env.DB.prepare(
    "INSERT INTO outbox (text, button_url, silent, created_at) VALUES (?1, ?2, ?3, 1000) RETURNING id",
  )
    .bind(text, buttonUrl, silent)
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
