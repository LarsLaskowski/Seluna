import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { DeliveryDeps, DeliveryLogEntry } from "./delivery";
import { RETRY_BATCH_SIZE, RETRY_GRACE_MS, retryPendingRows } from "./outbox-retry";
import { DEFAULT_SETTINGS } from "./settings";
import { DELIVERY_CHANNEL_SETTING, writeNotificationSettings, writeSetting } from "./store/settings";
import { TELEGRAM_CHANNEL } from "./channels/telegram";
import { testChannel } from "../test/channel";
import { applyMigrations } from "../test/d1";
import { FIXTURES, jsonAnswer, telegramDouble } from "../test/telegram";
import type { TelegramAnswers } from "../test/telegram";

const TOKEN = "123456789:AAH-throwaway_token0123456789abcdefghij";
const CHAT = 5_001_001;
const BUTTON_URL = "https://github.com/o/r/pull/7";
const READY_ENV = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: String(CHAT) };
const STARTED_AT = new Date("2026-10-17T12:34:00Z");
const MINUTE_MS = 60_000;

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([env.DB.prepare("DELETE FROM outbox"), env.DB.prepare("DELETE FROM settings")]);
});

interface RowOptions {
  readonly text?: string;
  readonly buttonUrl?: string | null;
  readonly attempts?: number;
  /** Milliseconds before `STARTED_AT` the row was written; two minutes by default. */
  readonly ageMs?: number;
}

/** Inserts a pending row and returns its id. */
async function insertRow(options: RowOptions = {}): Promise<number> {
  const { text = "<b>T</b> · o/r #7", buttonUrl = null, attempts = 0, ageMs = 2 * MINUTE_MS } = options;
  const row = await env.DB.prepare(
    "INSERT INTO outbox (text, button_url, silent, attempts, created_at) VALUES (?1, ?2, 0, ?3, ?4) RETURNING id",
  )
    .bind(text, buttonUrl, attempts, STARTED_AT.getTime() - ageMs)
    .first();
  const id = row?.id;
  if (typeof id !== "number") {
    throw new TypeError("The insert returned no id");
  }
  return id;
}

/** Inserts `count` rows, the n-th written `ageOf(n)` milliseconds before the start, in the order of n; their ids. */
async function insertRows(count: number, options: (index: number) => RowOptions): Promise<readonly number[]> {
  const ids: number[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(await insertRow(options(index)));
  }
  return ids;
}

async function stateOf(id: number): Promise<unknown> {
  return env.DB.prepare("SELECT status, attempts FROM outbox WHERE id = ?1").bind(id).first();
}

interface Harness {
  readonly deps: DeliveryDeps;
  readonly log: DeliveryLogEntry[];
  readonly telegram: ReturnType<typeof telegramDouble>;
}

function harness(answers: TelegramAnswers = {}, retryEnv: object = READY_ENV, db: D1Database = env.DB): Harness {
  const telegram = telegramDouble(answers);
  const log: DeliveryLogEntry[] = [];
  const deps: DeliveryDeps = {
    env: retryEnv,
    db,
    fetch: telegram.fetch,
    sleep: () => Promise.resolve(),
    log: (entry) => {
      log.push(entry);
    },
    now: () => STARTED_AT,
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

const SERVER_ERROR = jsonAnswer(500, { ok: false, error_code: 500 });
const ACCEPTED = jsonAnswer(200, FIXTURES.sendMessage);

describe("retryPendingRows (AC1: which rows are sent)", () => {
  it("retryPendingRows sends the 10 oldest due rows of 12 by created_at then id and marks them sent", async () => {
    // Row n is n + 2 minutes old, so the newest is written first and the order by age differs from the order by id;
    // the last row shares the timestamp of row 10.
    const ids = await insertRows(11, (index) => ({ text: `row ${String(index)}`, ageMs: (2 + index) * MINUTE_MS }));
    const tied = await insertRow({ text: "tied", ageMs: 12 * MINUTE_MS });
    const { deps, telegram } = harness({ sendMessage: ACCEPTED });

    const { result } = await retryPendingRows(STARTED_AT, deps);

    expect(result, "result").toBe("done");
    expect(telegram.requests.length, "number of requests").toBe(RETRY_BATCH_SIZE);
    expect(
      telegram.requests.map((request) => request.body),
      "texts in the order sent",
    ).toMatchObject([
      { text: "row 10" },
      { text: "tied" },
      { text: "row 9" },
      { text: "row 8" },
      { text: "row 7" },
      { text: "row 6" },
      { text: "row 5" },
      { text: "row 4" },
      { text: "row 3" },
      { text: "row 2" },
    ]);
    expect(await stateOf(ids[10] ?? -1), "oldest row").toEqual({ status: "sent", attempts: 1 });
    expect(await stateOf(ids[1] ?? -1), "second newest row").toEqual({ status: "pending", attempts: 0 });
    expect(await stateOf(ids[0] ?? -1), "newest row").toEqual({ status: "pending", attempts: 0 });
    expect(await stateOf(tied), "row tied with the oldest").toEqual({ status: "sent", attempts: 1 });
  });

  it("retryPendingRows sends a row written 60,001 ms before the start", async () => {
    const id = await insertRow({ ageMs: RETRY_GRACE_MS + 1 });
    const { deps, telegram } = harness({ sendMessage: ACCEPTED });

    const { result } = await retryPendingRows(STARTED_AT, deps);

    expect(result, "result").toBe("done");
    expect(telegram.requests.length, "number of requests").toBe(1);
    expect(await stateOf(id), "row").toEqual({ status: "sent", attempts: 1 });
  });

  it("retryPendingRows leaves a row written exactly 60,000 ms before the start unsent", async () => {
    const id = await insertRow({ ageMs: RETRY_GRACE_MS });
    const { deps, log, telegram } = harness({ sendMessage: ACCEPTED });

    const { result } = await retryPendingRows(STARTED_AT, deps);

    expect(result, "result").toBe("done");
    expect(telegram.requests.length, "number of requests").toBe(0);
    expect(await stateOf(id), "row").toEqual({ status: "pending", attempts: 0 });
    expect(log, "log entries").toEqual([]);
  });

  it("retryPendingRows sends a row with 4 attempts and not a row with 5 attempts", async () => {
    await insertRow({ text: "exhausted", attempts: 5, ageMs: 3 * MINUTE_MS });
    const fourth = await insertRow({ text: "fourth", attempts: 4 });
    const { deps, telegram } = harness({ sendMessage: ACCEPTED });

    await retryPendingRows(STARTED_AT, deps);

    expect(
      telegram.requests.map((request) => request.body),
      "requests",
    ).toMatchObject([{ text: "fourth" }]);
    expect(telegram.requests.length, "number of requests").toBe(1);
    expect(await stateOf(fourth), "row with 4 attempts").toEqual({ status: "sent", attempts: 5 });
  });

  it("retryPendingRows sends a row due in quiet hours silent with the button in the stored language", async () => {
    await writeNotificationSettings(env.DB, {
      ...DEFAULT_SETTINGS,
      language: "de",
      quietHours: { start: "12:00", end: "13:00" },
    });
    await insertRow({ text: "quiet", buttonUrl: BUTTON_URL });
    const { deps, telegram } = harness({ sendMessage: ACCEPTED });

    await retryPendingRows(STARTED_AT, deps);

    expect(telegram.requests.length, "number of requests").toBe(1);
    expect(telegram.requests[0]?.body, "request body").toMatchObject({
      disable_notification: true,
      reply_markup: { inline_keyboard: [[{ text: "Auf GitHub öffnen", url: BUTTON_URL }]] },
    });
  });

  it("retryPendingRows returns done and sends nothing when no row is due", async () => {
    const { deps, telegram } = harness();

    const { result } = await retryPendingRows(STARTED_AT, deps);

    expect(result, "result").toBe("done");
    expect(telegram.requests.length, "number of requests").toBe(0);
  });
});

describe("retryPendingRows (AC2: the fifth attempt)", () => {
  it("retryPendingRows marks a row with 5 attempts failed without a Telegram request and logs it", async () => {
    const id = await insertRow({ attempts: 5 });
    const { deps, log, telegram } = harness({ sendMessage: ACCEPTED });

    const { result } = await retryPendingRows(STARTED_AT, deps);

    expect(result, "result").toBe("done");
    expect(await stateOf(id), "row").toEqual({ status: "failed", attempts: 5 });
    expect(telegram.requests.length, "number of requests").toBe(0);
    expect(log, "log entries").toEqual([{ outbox: id, status: "failed" }]);
  });

  it("retryPendingRows marks at most 10 of 11 exhausted rows failed, oldest first, and logs each", async () => {
    const ids = await insertRows(11, (index) => ({ attempts: 5, ageMs: (2 + index) * MINUTE_MS }));
    const { deps, log } = harness();

    await retryPendingRows(STARTED_AT, deps);

    expect(log, "log entries").toEqual(
      ids
        .slice(1)
        .reverse()
        .map((id) => ({ outbox: id, status: "failed" })),
    );
    expect(await stateOf(ids[0] ?? -1), "newest exhausted row").toEqual({ status: "pending", attempts: 5 });
  });

  it("retryPendingRows marks a row failed with 5 attempts and logs the result and the status when the fifth send fails", async () => {
    const id = await insertRow({ attempts: 4 });
    const { deps, log } = harness({ sendMessage: SERVER_ERROR });

    await retryPendingRows(STARTED_AT, deps);

    expect(await stateOf(id), "row").toEqual({ status: "failed", attempts: 5 });
    expect(log, "log entries").toEqual([
      { outbox: id, result: "failed" },
      { outbox: id, status: "failed" },
    ]);
  });

  it("retryPendingRows returns store-failed and sends nothing when the exhausted rows cannot be marked", async () => {
    const id = await insertRow();
    const { deps, telegram } = harness({}, READY_ENV, dbFailingFor(env.DB, /UPDATE outbox SET status = 'failed'/));

    const { result } = await retryPendingRows(STARTED_AT, deps);

    expect(result, "result").toBe("store-failed");
    expect(telegram.requests.length, "number of requests").toBe(0);
    expect(await stateOf(id), "row").toEqual({ status: "pending", attempts: 0 });
  });

  it("retryPendingRows returns store-failed and sends nothing when the due rows cannot be read", async () => {
    const id = await insertRow();
    const { deps, telegram } = harness({}, READY_ENV, dbFailingFor(env.DB, /SELECT id, text/));

    const { result } = await retryPendingRows(STARTED_AT, deps);

    expect(result, "result").toBe("store-failed");
    expect(telegram.requests.length, "number of requests").toBe(0);
    expect(await stateOf(id), "row").toEqual({ status: "pending", attempts: 0 });
  });

  it("retryPendingRows returns store-failed and sends nothing when the settings cannot be read", async () => {
    const id = await insertRow();
    const { deps, telegram } = harness({}, READY_ENV, dbFailingFor(env.DB, /FROM settings/));

    const { result } = await retryPendingRows(STARTED_AT, deps);

    expect(result, "result").toBe("store-failed");
    expect(telegram.requests.length, "number of requests").toBe(0);
    expect(await stateOf(id), "row").toEqual({ status: "pending", attempts: 0 });
  });
});

describe("retryPendingRows (AC3: an outage and missing credentials)", () => {
  it("retryPendingRows keeps the row pending through three failed runs and sends it in the next run", async () => {
    const id = await insertRow();
    const { deps, telegram } = harness({ sendMessage: [SERVER_ERROR, SERVER_ERROR, SERVER_ERROR, ACCEPTED] });

    await retryPendingRows(STARTED_AT, deps);
    const afterFirst = await stateOf(id);
    await retryPendingRows(STARTED_AT, deps);
    const afterSecond = await stateOf(id);
    await retryPendingRows(STARTED_AT, deps);
    const afterThird = await stateOf(id);
    await retryPendingRows(STARTED_AT, deps);
    const afterFourth = await stateOf(id);

    expect(afterFirst, "after the first run").toEqual({ status: "pending", attempts: 1 });
    expect(afterSecond, "after the second run").toEqual({ status: "pending", attempts: 2 });
    expect(afterThird, "after the third run").toEqual({ status: "pending", attempts: 3 });
    expect(afterFourth, "after the fourth run").toEqual({ status: "sent", attempts: 4 });
    expect(telegram.requests.length, "number of requests").toBe(4);
  });

  it.each<{ case: string; retryEnv: object; result: string }>([
    { case: "no bot token", retryEnv: { TELEGRAM_CHAT_ID: String(CHAT) }, result: "no-token" },
    { case: "no chat", retryEnv: { TELEGRAM_BOT_TOKEN: TOKEN }, result: "no-chat" },
  ])(
    "retryPendingRows keeps a row with 4 attempts pending and logs $result for $case",
    async ({ retryEnv, result }) => {
      const id = await insertRow({ attempts: 4 });
      const { deps, log, telegram } = harness({}, retryEnv);

      const { result: outcome } = await retryPendingRows(STARTED_AT, deps);

      expect(outcome, "result").toBe("done");
      expect(await stateOf(id), "row").toEqual({ status: "pending", attempts: 4 });
      expect(telegram.requests.length, "number of requests").toBe(0);
      expect(log, "log entries").toEqual([{ outbox: id, result }]);
    },
  );

  it("retryPendingRows leaves the row pending and logs store-failed when marking it sent fails after Telegram accepted", async () => {
    const id = await insertRow();
    const { deps, log, telegram } = harness(
      { sendMessage: ACCEPTED },
      READY_ENV,
      dbFailingFor(env.DB, /SET status = 'sent'/),
    );

    const { result } = await retryPendingRows(STARTED_AT, deps);

    expect(result, "result").toBe("done");
    expect(telegram.requests.length, "the message was sent once").toBe(1);
    expect(await stateOf(id), "row").toEqual({ status: "pending", attempts: 0 });
    expect(log, "log entries").toEqual([{ outbox: id, result: "store-failed" }]);
  });
});

const NEW_FORM_TEXT =
  '{"title":"New pull request","repository":"octo/repo","number":7,"subject":"Fix <b> & </b>","context":"main"}';

describe("retryPendingRows through the active channel", () => {
  it("retryPendingRows sends a pending row through the newly activated test channel", async () => {
    const id = await insertRow({ text: NEW_FORM_TEXT, buttonUrl: BUTTON_URL, attempts: 2 });
    const channel = testChannel();
    const { deps, log, telegram } = harness({ sendMessage: ACCEPTED });
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");

    const { result } = await retryPendingRows(STARTED_AT, { ...deps, channels: [TELEGRAM_CHANNEL, channel] });

    expect(result, "result").toBe("done");
    expect(telegram.requests.length, "Telegram requests").toBe(0);
    expect(channel.sends.length, "sends through the test channel").toBe(1);
    expect(channel.sends[0]?.message, "message").toEqual({
      content: {
        kind: "notification",
        notification: {
          title: "New pull request",
          repository: "octo/repo",
          number: 7,
          subject: "Fix <b> & </b>",
          context: "main",
        },
      },
      buttonUrl: BUTTON_URL,
    });
    expect(await stateOf(id), "attempts carry over").toEqual({ status: "sent", attempts: 3 });
    expect(log, "log entries").toEqual([{ outbox: id, result: "sent" }]);
  });

  it("retryPendingRows hands an old-form row to the test channel as the notification its text holds", async () => {
    await insertRow({ text: "<b>T</b> · o/r #7\nS\nC" });
    const channel = testChannel();
    const { deps } = harness();
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");

    await retryPendingRows(STARTED_AT, { ...deps, channels: [TELEGRAM_CHANNEL, channel] });

    expect(channel.sends[0]?.notification, "notification the channel read").toEqual({
      title: "T",
      repository: "o/r",
      number: 7,
      subject: "S",
      context: "C",
    });
  });

  it("retryPendingRows sends a new-form row through Telegram as its rendered text", async () => {
    const id = await insertRow({ text: NEW_FORM_TEXT });
    const { deps, telegram } = harness({ sendMessage: ACCEPTED });

    await retryPendingRows(STARTED_AT, deps);

    expect(telegram.requests[0]?.body, "request body").toMatchObject({
      text: "<b>New pull request</b> · octo/repo #7\nFix &lt;b&gt; &amp; &lt;/b&gt;\nmain",
      parse_mode: "HTML",
    });
    expect(await stateOf(id), "row").toEqual({ status: "sent", attempts: 1 });
  });

  it("retryPendingRows counts a failed attempt for a damaged row, sends the other rows and stops no run", async () => {
    const damaged = await insertRow({ text: "{not json", ageMs: 5 * MINUTE_MS });
    const blob = await env.DB.prepare(
      "INSERT INTO outbox (text, button_url, silent, created_at) VALUES (X'3C623E', NULL, 0, ?1) RETURNING id",
    )
      .bind(STARTED_AT.getTime() - 4 * MINUTE_MS)
      .first();
    const good = await insertRow({ text: "<b>T</b> · o/r #7" });
    const { deps, log, telegram } = harness({ sendMessage: ACCEPTED });

    const { result } = await retryPendingRows(STARTED_AT, deps);

    expect(result, "result").toBe("done");
    expect(telegram.requests.length, "Telegram requests: only the readable row").toBe(1);
    expect(await stateOf(damaged), "undecodable row").toEqual({ status: "pending", attempts: 1 });
    expect(await stateOf(Number(blob?.id)), "blob row").toEqual({ status: "pending", attempts: 1 });
    expect(await stateOf(good), "readable row").toEqual({ status: "sent", attempts: 1 });
    expect(log, "log entries").toEqual([
      { outbox: damaged, result: "failed" },
      { outbox: blob?.id, result: "failed" },
      { outbox: good, result: "sent" },
    ]);
  });

  it("retryPendingRows leaves the attempts of a pending row unchanged while the active test channel is not ready", async () => {
    const id = await insertRow({ text: NEW_FORM_TEXT, attempts: 1 });
    const channel = testChannel({ configured: false, unavailable: "no-chat" });
    const { deps, log, telegram } = harness();
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");

    await retryPendingRows(STARTED_AT, { ...deps, channels: [TELEGRAM_CHANNEL, channel] });

    expect(telegram.requests.length, "Telegram requests").toBe(0);
    expect(await stateOf(id), "row").toEqual({ status: "pending", attempts: 1 });
    expect(log, "log entries").toEqual([{ outbox: id, result: "no-chat" }]);
  });
});

describe("retryPendingRows (the number of attempted rows)", () => {
  it("retryPendingRows counts 0 attempted rows when none is due", async () => {
    const { deps } = harness();

    const outcome = await retryPendingRows(STARTED_AT, deps);

    expect(outcome, "outcome").toEqual({ result: "done", attempted: 0 });
  });

  it("retryPendingRows counts the rows it handed to the channel", async () => {
    await insertRows(3, (index) => ({ ageMs: (2 + index) * MINUTE_MS }));
    const { deps } = harness({ sendMessage: ACCEPTED });

    const outcome = await retryPendingRows(STARTED_AT, deps);

    expect(outcome, "outcome").toEqual({ result: "done", attempted: 3 });
  });

  it("retryPendingRows counts at most 10 attempted rows when more are due", async () => {
    await insertRows(12, (index) => ({ ageMs: (2 + index) * MINUTE_MS }));
    const { deps } = harness({ sendMessage: ACCEPTED });

    const outcome = await retryPendingRows(STARTED_AT, deps);

    expect(outcome, "outcome").toEqual({ result: "done", attempted: RETRY_BATCH_SIZE });
  });

  it("retryPendingRows counts the rows even when the channel answers with an error", async () => {
    await insertRows(2, () => ({}));
    const { deps } = harness({ sendMessage: SERVER_ERROR });

    const outcome = await retryPendingRows(STARTED_AT, deps);

    expect(outcome, "outcome").toEqual({ result: "done", attempted: 2 });
  });

  it("retryPendingRows counts the rows when no token is set", async () => {
    await insertRows(2, () => ({}));
    const { deps } = harness({}, {});

    const outcome = await retryPendingRows(STARTED_AT, deps);

    expect(outcome, "outcome").toEqual({ result: "done", attempted: 2 });
  });

  it.each([
    { case: "the exhausted rows cannot be marked", failing: /UPDATE outbox SET status = 'failed'/ },
    { case: "the due rows cannot be read", failing: /SELECT id, text/ },
    { case: "the settings cannot be read", failing: /FROM settings/ },
  ])("retryPendingRows counts 0 attempted rows when $case", async ({ failing }) => {
    await insertRows(2, () => ({}));
    const { deps } = harness({}, READY_ENV, dbFailingFor(env.DB, failing));

    const outcome = await retryPendingRows(STARTED_AT, deps);

    expect(outcome, "outcome").toEqual({ result: "store-failed", attempted: 0 });
  });
});
