import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import forkFixture from "../test/fixtures/fork/fork.json";
import starCreated from "../test/fixtures/star/created.json";
import { runActivityDigest } from "./activity-digest";
import type { DeliveryDeps, DeliveryLogEntry } from "./delivery";
import { renderTelegramText } from "./message";
import { decodeStoredNotification } from "./notification";
import { retryPendingRows } from "./outbox-retry";
import { RULES } from "./rules/registry";
import type { WebhookPayload } from "./rules/rule";
import { DEFAULT_SETTINGS } from "./settings";
import type { NotificationSettings } from "./settings";
import { ACTIVITY_RETENTION_MS } from "./store/activity";
import { digestRunUpsert, readDigestRun } from "./store/meta";
import { writeNotificationSettings } from "./store/settings";
import { processWebhook } from "./webhook";
import type { SignedDelivery, WebhookDeps } from "./webhook";
import { failingBatchDb, hookedBatchDb, withoutActivityTable } from "../test/activity";
import { applyMigrations } from "../test/d1";
import { variant } from "../test/pull-request";
import { FIXTURES, jsonAnswer, telegramDouble } from "../test/telegram";
import type { TelegramAnswers } from "../test/telegram";

const TOKEN = "123456789:AAH-throwaway_token0123456789abcdefghij";
const READY_ENV = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "5001001" };
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const STARTED = new Date("2026-10-21T13:00:00Z");
const PREVIOUS = new Date("2026-10-21T12:50:00Z");
const ACCEPTED = jsonAnswer(200, FIXTURES.sendMessage);
const DIGEST_TEXT = "<b>New stars and forks</b>\nocto/repo: +2 ⭐ (now 7), +1 fork · alice, bob";
const REPOSITORY_URL = "https://github.com/octo/repo";

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM outbox"),
    env.DB.prepare("DELETE FROM activity"),
    env.DB.prepare("DELETE FROM settings"),
    env.DB.prepare("DELETE FROM meta"),
    env.DB.prepare("DELETE FROM deliveries"),
  ]);
});

/** Hourly digest in UTC with both switches on, with `changes` applied; `rules` replaces the two switches. */
async function configure(
  changes: Partial<NotificationSettings> = {},
  rules: { repository_starred: boolean; repository_forked: boolean } = {
    repository_starred: true,
    repository_forked: true,
  },
): Promise<void> {
  await writeNotificationSettings(env.DB, {
    ...DEFAULT_SETTINGS,
    activityDigest: { kind: "hourly" },
    rules: { ...DEFAULT_SETTINGS.rules, ...rules },
    ...changes,
  });
}

async function storeRun(time: Date): Promise<void> {
  await digestRunUpsert(env.DB, time).run();
}

async function runTime(): Promise<number | undefined> {
  return (await readDigestRun(env.DB))?.getTime();
}

interface RowSpec {
  readonly kind?: "star" | "fork";
  readonly senderId?: number;
  readonly login?: string;
  readonly repositoryId?: number;
  readonly repository?: string;
  readonly starCount?: number | null;
  readonly createdAt?: number;
}

/** Inserts an `activity` row, by default a star of `alice` on `octo/repo` half an hour before the start. */
async function addActivity(spec: RowSpec = {}): Promise<number> {
  const row = await env.DB.prepare(
    "INSERT INTO activity (kind, sender_id, sender_login, repository_id, repository, repository_url, star_count, created_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id",
  )
    .bind(
      spec.kind ?? "star",
      spec.senderId ?? 1,
      spec.login ?? "alice",
      spec.repositoryId ?? 5,
      spec.repository ?? "octo/repo",
      REPOSITORY_URL,
      spec.starCount === undefined ? null : spec.starCount,
      spec.createdAt ?? STARTED.getTime() - 30 * MINUTE_MS,
    )
    .first();
  const id = row?.id;
  if (typeof id !== "number") {
    throw new TypeError("The insert returned no id");
  }
  return id;
}

/** The three events of `DIGEST_TEXT`: two stars (the second knows 7 stars now) and a fork by `alice`. */
async function addDigestEvents(): Promise<void> {
  await addActivity({ senderId: 1, login: "alice", starCount: 6 });
  await addActivity({ senderId: 2, login: "bob", starCount: 7 });
  await addActivity({ kind: "fork", senderId: 1, login: "alice" });
}

async function activityCount(): Promise<unknown> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM activity").first();
  return row?.n;
}

async function outboxCount(): Promise<unknown> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM outbox").first();
  return row?.n;
}

/** The status, attempts, rendered text, button URL and silent flag of every outbox row, oldest first. */
async function outboxRows(): Promise<{ status: unknown; attempts: unknown; text: string; button: unknown }[]> {
  const { results } = await env.DB.prepare("SELECT status, attempts, text, button_url FROM outbox ORDER BY id").all();
  return results.map((row) => {
    const notification = typeof row.text === "string" ? decodeStoredNotification(row.text) : undefined;
    return {
      status: row.status,
      attempts: row.attempts,
      text: notification === undefined ? "" : renderTelegramText(notification),
      button: row.button_url,
    };
  });
}

interface Harness {
  readonly deps: DeliveryDeps;
  readonly telegram: ReturnType<typeof telegramDouble>;
  readonly log: DeliveryLogEntry[];
}

function harness(
  options: { readonly db?: D1Database; readonly answers?: TelegramAnswers; readonly now?: Date } = {},
): Harness {
  const telegram = telegramDouble(options.answers ?? { sendMessage: ACCEPTED });
  const log: DeliveryLogEntry[] = [];
  const deps: DeliveryDeps = {
    env: READY_ENV,
    db: options.db ?? env.DB,
    fetch: telegram.fetch,
    sleep: () => Promise.resolve(),
    log: (entry) => {
      log.push(entry);
    },
    now: () => options.now ?? STARTED,
  };
  return { deps, telegram, log };
}

/** A database whose `prepare` throws for the statements `failing` matches. */
function dbFailingFor(failing: RegExp): D1Database {
  return {
    prepare: (query: string) => {
      if (failing.test(query)) {
        throw new Error("The database failed");
      }
      return env.DB.prepare(query);
    },
    batch: (statements) => env.DB.batch(statements),
    exec: (query) => env.DB.exec(query),
    dump: () => Promise.reject(new Error("Not supported")),
    withSession: (constraintOrBookmark) => env.DB.withSession(constraintOrBookmark),
  };
}

describe("runActivityDigest with both switches off", () => {
  it("runActivityDigest only stores the run time and touches no activity table", async () => {
    await configure({}, { repository_starred: false, repository_forked: false });
    const { deps, telegram } = harness({ db: withoutActivityTable(env.DB) });

    const result = await runActivityDigest(STARTED, deps, true);

    expect(result, "result").toBe("off");
    expect(await runTime(), "run time").toBe(STARTED.getTime());
    expect(await outboxCount(), "outbox rows").toBe(0);
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("runActivityDigest keeps every row, also old ones, and replaces the stored run time", async () => {
    await configure({}, { repository_starred: false, repository_forked: false });
    await storeRun(PREVIOUS);
    await addDigestEvents();
    await addActivity({ senderId: 9, createdAt: STARTED.getTime() - 8 * DAY_MS });
    const { deps } = harness();

    const result = await runActivityDigest(STARTED, deps, true);

    expect(result, "result").toBe("off");
    expect(await activityCount(), "activity rows").toBe(4);
    expect(await runTime(), "run time").toBe(STARTED.getTime());
    expect(await outboxCount(), "outbox rows").toBe(0);
  });

  it.each([
    { case: "the star switch alone", rules: { repository_starred: true, repository_forked: false } },
    { case: "the fork switch alone", rules: { repository_starred: false, repository_forked: true } },
  ])("runActivityDigest sends the collected rows with $case on", async ({ rules }) => {
    await configure({}, rules);
    await storeRun(PREVIOUS);
    await addDigestEvents();
    const { deps } = harness();

    const result = await runActivityDigest(STARTED, deps, true);

    expect(result, "result").toBe("sent");
  });
});

describe("runActivityDigest: first run and runs that are not due", () => {
  it("runActivityDigest stores the run time and sends nothing on the first run", async () => {
    await configure();
    await addDigestEvents();
    const { deps, telegram } = harness();

    const result = await runActivityDigest(STARTED, deps, true);

    expect(["nothing-due", "empty"], "result").toContain(result);
    expect(await runTime(), "run time").toBe(STARTED.getTime());
    expect(await outboxCount(), "outbox rows").toBe(0);
    expect(await activityCount(), "activity rows").toBe(3);
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("runActivityDigest answers nothing-due, stores the run time and keeps the rows between two digest times", async () => {
    await configure();
    await storeRun(new Date("2026-10-21T13:00:00Z"));
    await addDigestEvents();
    const now = new Date("2026-10-21T13:10:00Z");
    const { deps, telegram } = harness({ now });

    const result = await runActivityDigest(now, deps, true);

    expect(result, "result").toBe("nothing-due");
    expect(await runTime(), "run time").toBe(now.getTime());
    expect(await activityCount(), "activity rows").toBe(3);
    expect(await outboxCount(), "outbox rows").toBe(0);
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("runActivityDigest deletes at most 1,000 rows older than seven days, oldest first, and keeps the rest", async () => {
    await configure();
    const now = new Date("2026-10-21T13:10:00Z");
    await storeRun(new Date("2026-10-21T13:00:00Z"));
    const cutoff = now.getTime() - ACTIVITY_RETENTION_MS;
    await env.DB.prepare(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1005) " +
        "INSERT INTO activity (kind, sender_id, sender_login, repository_id, repository, repository_url, star_count, created_at) " +
        "SELECT 'star', i, 'u' || i, 5, 'octo/repo', NULL, NULL, ?1 - 10000 + i FROM n",
    )
      .bind(cutoff)
      .run();
    await addActivity({ senderId: 2000, createdAt: cutoff });
    await addActivity({ senderId: 2001, createdAt: now.getTime() - MINUTE_MS });
    const { deps } = harness({ now });

    const result = await runActivityDigest(now, deps, true);

    expect(result, "result").toBe("nothing-due");
    expect(await activityCount(), "rows left: 5 old, the one at the cutoff and the fresh one").toBe(7);
    const oldest = await env.DB.prepare("SELECT MIN(sender_id) AS id FROM activity WHERE sender_id <= 1005").first();
    expect(oldest?.id, "the 1,000 oldest rows are gone").toBe(1001);
  });
});

describe("runActivityDigest when a digest is due", () => {
  it("runActivityDigest answers empty and stores the run time for an empty table", async () => {
    await configure();
    await storeRun(PREVIOUS);
    const { deps, telegram } = harness();

    const result = await runActivityDigest(STARTED, deps, true);

    expect(result, "result").toBe("empty");
    expect(await runTime(), "run time").toBe(STARTED.getTime());
    expect(await outboxCount(), "outbox rows").toBe(0);
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("runActivityDigest deletes stale rows without an outbox row when only stale rows exist", async () => {
    await configure();
    await storeRun(PREVIOUS);
    await addActivity({ senderId: 1, createdAt: STARTED.getTime() - 8 * DAY_MS });
    await addActivity({ senderId: 2, createdAt: STARTED.getTime() - 9 * DAY_MS });
    const { deps, telegram } = harness();

    const result = await runActivityDigest(STARTED, deps, true);

    expect(result, "result").toBe("empty");
    expect(await activityCount(), "activity rows").toBe(0);
    expect(await outboxCount(), "outbox rows").toBe(0);
    expect(await runTime(), "run time").toBe(STARTED.getTime());
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("runActivityDigest sends the digest, deletes the counted rows and the stale ones, and stores the run time", async () => {
    await configure();
    await storeRun(PREVIOUS);
    await addActivity({ senderId: 9, login: "old", createdAt: STARTED.getTime() - 8 * DAY_MS });
    await addDigestEvents();
    const { deps, telegram } = harness();

    const result = await runActivityDigest(STARTED, deps, true);

    expect(result, "result").toBe("sent");
    expect(await outboxRows(), "outbox").toEqual([
      { status: "sent", attempts: 1, text: DIGEST_TEXT, button: REPOSITORY_URL },
    ]);
    expect(telegram.requests, "Telegram requests").toHaveLength(1);
    expect(telegram.requests[0]?.body, "request body").toMatchObject({
      text: DIGEST_TEXT,
      reply_markup: { inline_keyboard: [[{ text: "Open on GitHub", url: REPOSITORY_URL }]] },
    });
    expect(await activityCount(), "activity rows").toBe(0);
    expect(await runTime(), "run time").toBe(STARTED.getTime());
  });

  it("runActivityDigest leaves the digest pending and unsent without sendNow", async () => {
    await configure();
    await storeRun(PREVIOUS);
    await addDigestEvents();
    const { deps, telegram } = harness();

    const result = await runActivityDigest(STARTED, deps, false);

    expect(result, "result").toBe("queued");
    expect(await outboxRows(), "outbox").toEqual([
      { status: "pending", attempts: 0, text: DIGEST_TEXT, button: REPOSITORY_URL },
    ]);
    expect(telegram.requests, "Telegram requests").toEqual([]);
    expect(await activityCount(), "activity rows").toBe(0);
    expect(await runTime(), "run time").toBe(STARTED.getTime());
  });

  it("runActivityDigest builds the digest in the language of the settings", async () => {
    await configure({ language: "de" });
    await storeRun(PREVIOUS);
    await addDigestEvents();
    const { deps } = harness();

    await runActivityDigest(STARTED, deps, false);

    expect((await outboxRows())[0]?.text, "text").toBe(
      "<b>Neue Sterne und Forks</b>\nocto/repo: +2 ⭐ (jetzt 7), +1 Fork · alice, bob",
    );
  });

  it("runActivityDigest sends the digest without sound inside the quiet hours", async () => {
    await configure({ quietHours: { start: "12:00", end: "14:00" } });
    await storeRun(PREVIOUS);
    await addDigestEvents();
    const { deps, telegram } = harness();

    await runActivityDigest(STARTED, deps, true);

    expect(telegram.requests[0]?.body, "request body").toMatchObject({ disable_notification: true });
  });

  it("runActivityDigest sends the digest with sound outside the quiet hours", async () => {
    await configure({ quietHours: { start: "01:00", end: "02:00" } });
    await storeRun(PREVIOUS);
    await addDigestEvents();
    const { deps, telegram } = harness();

    await runActivityDigest(STARTED, deps, true);

    expect(telegram.requests[0]?.body, "request body").not.toMatchObject({ disable_notification: true });
  });

  it("runActivityDigest counts only the rows of the last seven days", async () => {
    await configure();
    await storeRun(PREVIOUS);
    await addActivity({
      senderId: 1,
      login: "alice",
      starCount: 3,
      createdAt: STARTED.getTime() - ACTIVITY_RETENTION_MS,
    });
    await addActivity({
      senderId: 2,
      login: "bob",
      starCount: 4,
      createdAt: STARTED.getTime() - ACTIVITY_RETENTION_MS - 1,
    });
    const { deps } = harness();

    await runActivityDigest(STARTED, deps, false);

    expect((await outboxRows())[0]?.text, "text").toBe("<b>New stars and forks</b>\nocto/repo: +1 ⭐ (now 3) · alice");
    expect(await activityCount(), "activity rows").toBe(0);
  });
});

describe("runActivityDigest and changes of the settings (S9)", () => {
  it("runActivityDigest keeps the rows after a change from hourly to daily until the new digest time", async () => {
    await configure({ activityDigest: { kind: "daily", time: "18:00" } });
    await storeRun(PREVIOUS);
    await addDigestEvents();
    const { deps } = harness();

    const early = await runActivityDigest(STARTED, deps, true);
    const atTime = new Date("2026-10-21T18:00:00Z");
    await storeRun(new Date("2026-10-21T17:50:00Z"));
    const late = await runActivityDigest(atTime, harness({ now: atTime }).deps, true);

    expect(early, "run at the old digest time").toBe("nothing-due");
    expect(await activityCount(), "rows are sent at 18:00 only").toBe(0);
    expect(late, "run at the new digest time").toBe("sent");
    expect(await outboxCount(), "outbox rows").toBe(1);
  });

  it("runActivityDigest waits for the changed digest time", async () => {
    await configure({ activityDigest: { kind: "daily", time: "20:00" } });
    await storeRun(new Date("2026-10-21T17:50:00Z"));
    await addDigestEvents();
    const now = new Date("2026-10-21T18:00:00Z");
    const { deps } = harness({ now });

    const result = await runActivityDigest(now, deps, true);

    expect(result, "result").toBe("nothing-due");
    expect(await activityCount(), "activity rows").toBe(3);
  });

  it("runActivityDigest follows a changed time zone", async () => {
    await configure({ activityDigest: { kind: "daily", time: "18:00" }, timeZone: "America/New_York" });
    await storeRun(new Date("2026-10-21T21:50:00Z"));
    await addDigestEvents();
    const now = new Date("2026-10-21T22:00:00Z");
    const { deps } = harness({ now });

    const result = await runActivityDigest(now, deps, true);

    expect(result, "18:00 in America/New_York is 22:00 UTC").toBe("sent");
  });

  it("runActivityDigest sends the leftover rows at the next run once the interval is Immediately", async () => {
    await configure({ activityDigest: { kind: "immediate" } });
    await storeRun(new Date("2026-10-21T12:55:00Z"));
    await addDigestEvents();
    const { deps } = harness();

    const result = await runActivityDigest(STARTED, deps, true);

    expect(result, "result").toBe("sent");
    expect(await activityCount(), "activity rows").toBe(0);
    expect((await outboxRows())[0]?.text, "text").toBe(DIGEST_TEXT);
  });

  it("runActivityDigest answers empty under Immediately when nothing is left", async () => {
    await configure({ activityDigest: { kind: "immediate" } });
    await storeRun(new Date("2026-10-21T12:55:00Z"));
    const { deps } = harness();

    const result = await runActivityDigest(STARTED, deps, true);

    expect(result, "result").toBe("empty");
    expect(await outboxCount(), "outbox rows").toBe(0);
  });

  it("runActivityDigest sends rows collected while the switches were off once a switch is on", async () => {
    await configure({}, { repository_starred: false, repository_forked: false });
    await storeRun(PREVIOUS);
    await addDigestEvents();
    await runActivityDigest(
      new Date("2026-10-21T12:55:00Z"),
      harness({ now: new Date("2026-10-21T12:55:00Z") }).deps,
      true,
    );
    await configure();
    const { deps } = harness();

    const result = await runActivityDigest(STARTED, deps, true);

    expect(result, "result").toBe("sent");
    expect(await outboxCount(), "outbox rows").toBe(1);
  });

  it("runActivityDigest sends no digest before the next digest time when nothing was collected at a due time", async () => {
    await configure();
    await storeRun(PREVIOUS);
    const first = await runActivityDigest(STARTED, harness().deps, true);
    await addActivity({ createdAt: STARTED.getTime() + 5 * MINUTE_MS });
    const nextRun = new Date("2026-10-21T13:10:00Z");
    const second = await runActivityDigest(nextRun, harness({ now: nextRun }).deps, true);
    const nextHour = new Date("2026-10-21T14:00:00Z");
    const third = await runActivityDigest(nextHour, harness({ now: nextHour }).deps, true);

    expect(first, "due run with nothing collected").toBe("empty");
    expect(second, "run after the event").toBe("nothing-due");
    expect(third, "next digest time").toBe("sent");
    expect(await outboxCount(), "outbox rows").toBe(1);
  });
});

describe("runActivityDigest and an event during the run (AC9)", () => {
  it("runActivityDigest keeps an event inserted between its reads and its commit for the next digest", async () => {
    await configure();
    await storeRun(PREVIOUS);
    await addDigestEvents();
    const db = hookedBatchDb(env.DB, async () => {
      await addActivity({ senderId: 3, login: "carol", repository: "octo/repo", starCount: 8 });
    });
    const { deps } = harness({ db });

    const result = await runActivityDigest(STARTED, deps, false);

    expect(result, "result").toBe("queued");
    expect((await outboxRows())[0]?.text, "the digest counts only the events it read").toBe(DIGEST_TEXT);
    expect(await activityCount(), "the later event stays").toBe(1);
    const nextHour = new Date("2026-10-21T14:00:00Z");
    const next = await runActivityDigest(nextHour, harness({ now: nextHour }).deps, false);
    expect(next, "next digest").toBe("queued");
    expect((await outboxRows())[1]?.text, "the next digest counts it").toBe(
      "<b>New stars and forks</b>\nocto/repo: +1 ⭐ (now 8) · carol",
    );
    expect(await activityCount(), "nothing left").toBe(0);
  });
});

describe("runActivityDigest when D1 fails (AC10, AC12)", () => {
  it.each([
    { case: "the summary read", db: () => dbFailingFor(/activity/) },
    { case: "the settings read", db: () => dbFailingFor(/FROM settings/) },
    { case: "the run time read", db: () => dbFailingFor(/FROM meta/) },
    { case: "the commit batch", db: () => failingBatchDb(env.DB) },
  ])(
    "runActivityDigest answers store-failed, sends nothing and keeps rows and run time when $case fails",
    async ({ db }) => {
      await configure();
      await storeRun(PREVIOUS);
      await addDigestEvents();
      const { deps, telegram } = harness({ db: db() });

      const result = await runActivityDigest(STARTED, deps, true);

      expect(result, "result").toBe("store-failed");
      expect(await activityCount(), "activity rows").toBe(3);
      expect(await outboxCount(), "outbox rows").toBe(0);
      expect(await runTime(), "run time").toBe(PREVIOUS.getTime());
      expect(telegram.requests, "Telegram requests").toEqual([]);
    },
  );

  it.each([
    { case: "a due run", previous: PREVIOUS, now: STARTED },
    {
      case: "a run that is not due",
      previous: new Date("2026-10-21T13:00:00Z"),
      now: new Date("2026-10-21T13:10:00Z"),
    },
  ])(
    "runActivityDigest answers store-failed for $case when the activity table is missing and a switch is on",
    async ({ previous, now }) => {
      await configure();
      await storeRun(previous);
      const { deps } = harness({ db: withoutActivityTable(env.DB), now });

      const result = await runActivityDigest(now, deps, true);

      expect(result, "result").toBe("store-failed");
      expect(await runTime(), "run time").toBe(previous.getTime());
    },
  );

  it("runActivityDigest never rejects when D1 fails", async () => {
    await configure();
    await storeRun(PREVIOUS);
    const { deps } = harness({ db: dbFailingFor(/./) });

    await expect(runActivityDigest(STARTED, deps, true), "run").resolves.toBe("store-failed");
  });

  it("runActivityDigest leaves an undelivered digest pending, and the retry sends it once without a second digest", async () => {
    await configure();
    await storeRun(PREVIOUS);
    await addDigestEvents();
    const failing = harness({ answers: { sendMessage: jsonAnswer(500, { ok: false, error_code: 500 }) } });

    await runActivityDigest(STARTED, failing.deps, true);

    expect(await outboxRows(), "after the failed send").toEqual([
      { status: "pending", attempts: 1, text: DIGEST_TEXT, button: REPOSITORY_URL },
    ]);
    const next = new Date("2026-10-21T13:10:00Z");
    const again = await runActivityDigest(next, harness({ now: next }).deps, true);
    const retry = harness({ now: next });
    const outcome = await retryPendingRows(next, retry.deps);
    expect(again, "the next job run").toBe("nothing-due");
    expect(outcome, "retry outcome").toEqual({ result: "done", attempted: 1 });
    expect(await outboxRows(), "after the retry").toEqual([
      { status: "sent", attempts: 2, text: DIGEST_TEXT, button: REPOSITORY_URL },
    ]);
    expect(retry.telegram.requests, "Telegram requests of the retry").toHaveLength(1);
  });
});

/** A signed `star` or `fork` delivery of the account `senderId`. */
function activityDelivery(
  event: "star" | "fork",
  payload: WebhookPayload,
  id: string,
  senderId: number,
): SignedDelivery {
  const sent = variant(variant(payload, ["sender", "id"], senderId), ["sender", "login"], `user${String(senderId)}`);
  return {
    delivery: id,
    event,
    contentType: "application/json",
    body: new TextEncoder().encode(JSON.stringify(sent)),
  };
}

describe("the digest of 50 stars and 2 forks (AC4)", () => {
  it("one job run at the next full hour sends exactly one message with the line of the hourly example", async () => {
    await configure({ activityDigest: { kind: "hourly" } });
    await storeRun(new Date("2026-10-21T12:05:00Z"));
    const received = new Date("2026-10-21T12:30:00Z");
    const telegram = telegramDouble({ sendMessage: ACCEPTED });
    const webhook: WebhookDeps = {
      db: env.DB,
      env: READY_ENV,
      now: () => received,
      rules: RULES,
      waitUntil: vi.fn<(promise: Promise<void>) => void>(),
      telegramFetch: telegram.fetch,
      sleep: () => Promise.resolve(),
      log: () => undefined,
      lookUpDraft: () => Promise.resolve({ kind: "failed" }),
      readOwner: () => Promise.resolve(undefined),
    };
    for (let sender = 1; sender <= 50; sender += 1) {
      const payload = variant(starCreated, ["repository", "stargazers_count"], 1234 + sender);
      await processWebhook(activityDelivery("star", payload, `s-${String(sender)}`, sender), webhook);
    }
    await processWebhook(activityDelivery("fork", forkFixture, "f-1", 1), webhook);
    await processWebhook(activityDelivery("fork", forkFixture, "f-2", 51), webhook);
    expect(await activityCount(), "collected rows").toBe(52);
    expect(await outboxCount(), "no message before the digest").toBe(0);
    const { deps, telegram: digestTelegram } = harness();

    const result = await runActivityDigest(STARTED, deps, true);

    expect(result, "result").toBe("sent");
    expect(await outboxRows(), "outbox").toEqual([
      {
        status: "sent",
        attempts: 1,
        text:
          "<b>New stars and forks</b>\nexample-owner/example-repo: +50 ⭐ (now 1,284), +2 forks · " +
          "user1, user2, user3, user4, user5 and 46 more",
        button: "https://github.com/example-owner/example-repo",
      },
    ]);
    expect(digestTelegram.requests, "Telegram requests").toHaveLength(1);
    expect(await activityCount(), "collected rows are deleted").toBe(0);
  });
});
