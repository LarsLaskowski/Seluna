import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { DeliveryLogEntry } from "./delivery";
import { runScheduled } from "./scheduled";
import type { ScheduledDeps, ScheduledLogEntry } from "./scheduled";
import { DEFAULT_SETTINGS } from "./settings";
import { writeNotificationSettings } from "./store/settings";
import { applyMigrations } from "../test/d1";
import { githubApiDouble, jsonAnswer as githubAnswer, latestReleaseBody } from "../test/github";
import { FIXTURES, jsonAnswer, telegramDouble } from "../test/telegram";
import type { TelegramAnswers } from "../test/telegram";
import { digestRunUpsert, readDigestRun } from "./store/meta";
import { withoutActivityTable } from "../test/activity";

const TOKEN = "123456789:AAH-throwaway_token0123456789abcdefghij";
const CHAT = 5_001_001;
const READY_ENV = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: String(CHAT) };
const STARTED_AT = new Date("2026-10-21T05:17:00Z");
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const ERROR_TEXT = "secret-database-detail";
const ACCEPTED = jsonAnswer(200, FIXTURES.sendMessage);

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM deliveries"),
    env.DB.prepare("DELETE FROM outbox"),
    env.DB.prepare("DELETE FROM activity"),
    env.DB.prepare("DELETE FROM settings"),
    env.DB.prepare("DELETE FROM meta"),
  ]);
});

type LogEntry = ScheduledLogEntry | DeliveryLogEntry;

interface Harness {
  readonly deps: ScheduledDeps;
  readonly log: LogEntry[];
  readonly telegram: ReturnType<typeof telegramDouble>;
  readonly github: ReturnType<typeof githubApiDouble>;
}

interface HarnessOptions {
  readonly db?: D1Database;
  readonly answers?: TelegramAnswers;
  readonly now?: Date;
  readonly log?: (entry: LogEntry) => void;
}

function harness(options: HarnessOptions = {}): Harness {
  const telegram = telegramDouble(options.answers ?? { sendMessage: ACCEPTED });
  const github = githubApiDouble({ latestRelease: githubAnswer(200, latestReleaseBody({ tag_name: "v0.5.0" })) });
  const log: LogEntry[] = [];
  const deps: ScheduledDeps = {
    env: READY_ENV,
    db: options.db ?? env.DB,
    now: () => options.now ?? STARTED_AT,
    telegramFetch: telegram.fetch,
    githubFetch: github.fetch,
    sleep: () => Promise.resolve(),
    log:
      options.log ??
      ((entry) => {
        log.push(entry);
      }),
    version: "0.4.0",
  };
  return { deps, log, telegram, github };
}

/** The entries of the scheduled jobs, without the entries of single deliveries. */
function jobEntries(log: readonly LogEntry[]): readonly LogEntry[] {
  return log.filter((entry) => "job" in entry);
}

/** A database that passes everything to `env.DB` except what `failing` names. */
interface Failing {
  /** A statement whose text matches makes `prepare` throw. */
  readonly prepare?: RegExp;
  /** The first batch rejects. */
  readonly firstBatch?: boolean;
}

function dbFailing(failing: Failing): D1Database {
  const unsupported = (): never => {
    throw new Error("Not supported by this wrapper");
  };
  let batches = 0;
  return {
    prepare: (query: string) => {
      if (failing.prepare?.test(query) === true) {
        throw new Error(ERROR_TEXT);
      }
      return env.DB.prepare(query);
    },
    batch: (statements) => {
      batches += 1;
      return failing.firstBatch === true && batches === 1
        ? Promise.reject(new Error(ERROR_TEXT))
        : env.DB.batch(statements);
    },
    exec: unsupported,
    dump: unsupported,
    withSession: unsupported,
  };
}

/** A database every use of which throws. */
function untouchableDb(): D1Database {
  const touched = (): never => {
    throw new Error("The database was touched");
  };
  return { prepare: touched, batch: touched, exec: touched, dump: touched, withSession: touched };
}

async function insertDelivery(id: string, receivedAt: number): Promise<void> {
  await env.DB.prepare("INSERT INTO deliveries (id, event, received_at) VALUES (?1, 'ping', ?2)")
    .bind(id, receivedAt)
    .run();
}

/** Inserts a pending row written two minutes before the start and returns its id. */
async function insertDueRow(): Promise<number> {
  const row = await env.DB.prepare(
    "INSERT INTO outbox (text, silent, created_at) VALUES ('<b>T</b> · o/r #7', 0, ?1) RETURNING id",
  )
    .bind(STARTED_AT.getTime() - 2 * MINUTE_MS)
    .first();
  const id = row?.id;
  if (typeof id !== "number") {
    throw new TypeError("The insert returned no id");
  }
  return id;
}

async function deliveryIds(): Promise<readonly unknown[]> {
  const { results } = await env.DB.prepare("SELECT id FROM deliveries ORDER BY id").all();
  return results.map((row) => row.id);
}

async function statusOf(id: number): Promise<unknown> {
  const row = await env.DB.prepare("SELECT status FROM outbox WHERE id = ?1").bind(id).first();
  return row?.status;
}

describe("runScheduled (AC10: the dispatch)", () => {
  it("runScheduled runs cleanup and retry for */10 * * * * and makes no GitHub request", async () => {
    await insertDelivery("old", STARTED_AT.getTime() - 8 * DAY_MS);
    await insertDelivery("recent", STARTED_AT.getTime() - DAY_MS);
    const id = await insertDueRow();
    const { deps, github, telegram, log } = harness();

    await runScheduled("*/10 * * * *", deps);

    expect(await deliveryIds(), "remaining deliveries").toEqual(["recent"]);
    expect(await statusOf(id), "status of the due row").toBe("sent");
    expect(telegram.methods(), "Bot API methods called").toEqual(["sendMessage"]);
    expect(github.requests.length, "number of GitHub requests").toBe(0);
    expect(jobEntries(log), "job log entries").toEqual([]);
  });

  it("runScheduled runs only the release check for 17 5 * * * and logs its result once", async () => {
    await insertDelivery("old", STARTED_AT.getTime() - 8 * DAY_MS);
    const { deps, github, telegram, log } = harness();

    await runScheduled("17 5 * * *", deps);

    expect(jobEntries(log), "job log entries").toEqual([{ job: "release-check", result: "reported" }]);
    expect(
      github.requests.map((request) => request.route),
      "GitHub routes",
    ).toEqual(["latestRelease"]);
    expect(github.requests[0]?.authorization, "Authorization header").toBeNull();
    expect(telegram.methods(), "Bot API methods called").toEqual(["sendMessage"]);
    expect(await deliveryIds(), "remaining deliveries").toEqual(["old"]);
  });

  it("runScheduled logs the fixed result off for 17 5 * * * with the update notice off and makes no request", async () => {
    await writeNotificationSettings(env.DB, { ...DEFAULT_SETTINGS, updateNotice: false });
    const { deps, github, telegram, log } = harness();

    await runScheduled("17 5 * * *", deps);

    expect(jobEntries(log), "job log entries").toEqual([{ job: "release-check", result: "off" }]);
    expect(github.requests.length, "number of GitHub requests").toBe(0);
    expect(telegram.requests.length, "number of Telegram requests").toBe(0);
  });

  it.each(["0 * * * *", "", "*/10 * * * * ", "17 5 * * 1", "*/5 * * * *"])(
    "runScheduled logs exactly one unknown-schedule entry and touches nothing for the cron %j",
    async (cron) => {
      const { deps, github, telegram, log } = harness({ db: untouchableDb() });

      await runScheduled(cron, deps);

      expect(log, "log entries").toEqual([{ job: "schedule", result: "unknown" }]);
      expect(github.requests.length, "number of GitHub requests").toBe(0);
      expect(telegram.requests.length, "number of Telegram requests").toBe(0);
    },
  );
});

describe("runScheduled (AC5: the jobs are isolated)", () => {
  it("runScheduled logs the cleanup as store-failed and still sends a due row when the cleanup batch fails", async () => {
    await insertDelivery("old", STARTED_AT.getTime() - 8 * DAY_MS);
    const id = await insertDueRow();
    const { deps, log, telegram } = harness({ db: dbFailing({ firstBatch: true }) });

    await runScheduled("*/10 * * * *", deps);

    expect(jobEntries(log), "job log entries").toEqual([{ job: "cleanup", result: "store-failed" }]);
    expect(await statusOf(id), "status of the due row").toBe("sent");
    expect(telegram.methods(), "Bot API methods called").toEqual(["sendMessage"]);
    expect(await deliveryIds(), "remaining deliveries").toEqual(["old"]);
    expect(JSON.stringify(log), "serialized log").not.toContain(ERROR_TEXT);
  });

  it("runScheduled logs the retry as store-failed and still deletes old rows when reading the rows fails", async () => {
    await insertDelivery("old", STARTED_AT.getTime() - 8 * DAY_MS);
    const id = await insertDueRow();
    const { deps, log, telegram } = harness({ db: dbFailing({ prepare: /UPDATE outbox SET status = 'failed'/ }) });

    await runScheduled("*/10 * * * *", deps);

    expect(jobEntries(log), "job log entries").toEqual([{ job: "retry", result: "store-failed" }]);
    expect(await deliveryIds(), "remaining deliveries").toEqual([]);
    expect(await statusOf(id), "status of the due row").toBe("pending");
    expect(telegram.requests.length, "number of Telegram requests").toBe(0);
    expect(JSON.stringify(log), "serialized log").not.toContain(ERROR_TEXT);
  });

  it("runScheduled logs the release check as store-failed without the error text when reading the settings fails", async () => {
    const { deps, log, github } = harness({ db: dbFailing({ prepare: /FROM settings/ }) });

    await runScheduled("17 5 * * *", deps);

    expect(log, "log entries").toEqual([{ job: "release-check", result: "store-failed" }]);
    expect(github.requests.length, "number of GitHub requests").toBe(0);
  });

  it("runScheduled resolves and still runs the retry when the log sink throws on the cleanup entry", async () => {
    const id = await insertDueRow();
    const { deps, telegram } = harness({
      db: dbFailing({ firstBatch: true }),
      log: () => {
        throw new Error(ERROR_TEXT);
      },
    });

    await expect(runScheduled("*/10 * * * *", deps), "the run").resolves.toBeUndefined();

    expect(await statusOf(id), "status of the due row").toBe("sent");
    expect(telegram.methods(), "Bot API methods called").toEqual(["sendMessage"]);
  });

  it("runScheduled resolves when the log sink throws on an unknown schedule", async () => {
    const { deps } = harness({
      log: () => {
        throw new Error(ERROR_TEXT);
      },
    });

    await expect(runScheduled("0 * * * *", deps), "the run").resolves.toBeUndefined();
  });
});

const DIGEST_NOW = new Date("2026-10-21T13:00:00Z");
const DIGEST_PREVIOUS = new Date("2026-10-21T12:50:00Z");
const DIGEST_TITLE = "<b>New stars and forks</b>";
const TOO_MANY = jsonAnswer(429, FIXTURES.tooManyRequests);

/** An hourly digest in UTC with both switches on, the last digest run ten minutes before `DIGEST_NOW`. */
async function configureDigest(on = true): Promise<void> {
  await writeNotificationSettings(env.DB, {
    ...DEFAULT_SETTINGS,
    activityDigest: { kind: "hourly" },
    rules: { ...DEFAULT_SETTINGS.rules, repository_starred: on, repository_forked: on },
  });
  await digestRunUpsert(env.DB, DIGEST_PREVIOUS).run();
}

/** Collects one star of `alice` on `octo/repo`, half an hour before `DIGEST_NOW`. */
async function addStar(): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO activity (kind, sender_id, sender_login, repository_id, repository, repository_url, star_count, created_at) " +
      "VALUES ('star', 1, 'alice', 5, 'octo/repo', 'https://github.com/octo/repo', 3, ?1)",
  )
    .bind(DIGEST_NOW.getTime() - 30 * MINUTE_MS)
    .run();
}

/** Inserts `count` pending rows written two minutes before `DIGEST_NOW`, with `attempts` attempts each. */
async function insertDueRows(count: number, attempts = 0): Promise<readonly number[]> {
  const ids: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = await env.DB.prepare(
      "INSERT INTO outbox (text, silent, attempts, created_at) VALUES ('<b>T</b> · o/r #7', 0, ?1, ?2) RETURNING id",
    )
      .bind(attempts, DIGEST_NOW.getTime() - 2 * MINUTE_MS + index)
      .first();
    const id = row?.id;
    if (typeof id !== "number") {
      throw new TypeError("The insert returned no id");
    }
    ids.push(id);
  }
  return ids;
}

async function activityCount(): Promise<unknown> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM activity").first();
  return row?.n;
}

async function digestRows(): Promise<{ status: unknown; attempts: unknown }[]> {
  const { results } = await env.DB.prepare("SELECT status, attempts, text FROM outbox WHERE text LIKE ?1 ORDER BY id")
    .bind('{"title":"New stars and forks"%')
    .all();
  return results.map((row) => ({ status: row.status, attempts: row.attempts }));
}

function sentTexts(telegram: ReturnType<typeof telegramDouble>): unknown[] {
  return telegram.requests.map((request) =>
    typeof request.body === "object" && request.body !== null && "text" in request.body ? request.body.text : undefined,
  );
}

describe("runScheduled and the activity digest", () => {
  it("runScheduled runs cleanup, then the retry, then the digest, which is sent in the same run", async () => {
    await configureDigest();
    await addStar();
    await insertDelivery("old", DIGEST_NOW.getTime() - 8 * DAY_MS);
    const [id] = await insertDueRows(1);
    const { deps, telegram, log } = harness({ now: DIGEST_NOW });

    await runScheduled("*/10 * * * *", deps);

    expect(await deliveryIds(), "cleanup deleted the old delivery").toEqual([]);
    expect(sentTexts(telegram), "the retry row first, then the digest").toEqual([
      "<b>T</b> · o/r #7",
      `${DIGEST_TITLE}\nocto/repo: +1 ⭐ (now 3) · alice`,
    ]);
    expect(await statusOf(id ?? -1), "status of the retry row").toBe("sent");
    expect(await digestRows(), "digest row").toEqual([{ status: "sent", attempts: 1 }]);
    expect(await activityCount(), "activity rows").toBe(0);
    expect((await readDigestRun(env.DB))?.getTime(), "run time").toBe(DIGEST_NOW.getTime());
    expect(jobEntries(log), "job log entries").toEqual([]);
  });

  it("runScheduled sends the digest in the run when the retry handed 9 rows to the channel", async () => {
    await configureDigest();
    await addStar();
    await insertDueRows(9);
    const { deps, telegram } = harness({ now: DIGEST_NOW });

    await runScheduled("*/10 * * * *", deps);

    expect(telegram.requests, "Telegram requests: 9 rows and the digest").toHaveLength(10);
    expect(await digestRows(), "digest row").toEqual([{ status: "sent", attempts: 1 }]);
  });

  it("runScheduled still runs the digest when the cleanup batch fails", async () => {
    await configureDigest();
    await addStar();
    const { deps, log, telegram } = harness({ db: dbFailing({ firstBatch: true }), now: DIGEST_NOW });

    await runScheduled("*/10 * * * *", deps);

    expect(jobEntries(log), "job log entries").toEqual([{ job: "cleanup", result: "store-failed" }]);
    expect(telegram.requests, "Telegram requests").toHaveLength(1);
    expect(await digestRows(), "digest row").toEqual([{ status: "sent", attempts: 1 }]);
  });

  it("runScheduled still runs the digest, with sendNow, when the retry fails", async () => {
    await configureDigest();
    await addStar();
    await insertDueRows(1);
    const { deps, log, telegram } = harness({
      db: dbFailing({ prepare: /UPDATE outbox SET status = 'failed'/ }),
      now: DIGEST_NOW,
    });

    await runScheduled("*/10 * * * *", deps);

    expect(jobEntries(log), "job log entries").toEqual([{ job: "retry", result: "store-failed" }]);
    expect(await digestRows(), "digest row").toEqual([{ status: "sent", attempts: 1 }]);
    expect(telegram.requests, "Telegram requests: only the digest").toHaveLength(1);
  });

  it("runScheduled logs one digest store-failed entry and still runs cleanup and retry when the table is missing", async () => {
    await configureDigest();
    await insertDelivery("old", DIGEST_NOW.getTime() - 8 * DAY_MS);
    const [id] = await insertDueRows(1);
    const { deps, log, telegram } = harness({ db: withoutActivityTable(env.DB), now: DIGEST_NOW });

    await runScheduled("*/10 * * * *", deps);

    expect(jobEntries(log), "job log entries").toEqual([{ job: "digest", result: "store-failed" }]);
    expect(await deliveryIds(), "cleanup ran").toEqual([]);
    expect(await statusOf(id ?? -1), "retry ran").toBe("sent");
    expect(telegram.requests, "Telegram requests").toHaveLength(1);
    expect(JSON.stringify(log), "serialized log").not.toContain("no such table");
    expect((await readDigestRun(env.DB))?.getTime(), "run time stays").toBe(DIGEST_PREVIOUS.getTime());
  });

  it("runScheduled with both switches off only stores the run time and logs nothing about the digest", async () => {
    await configureDigest(false);
    const { deps, log, telegram } = harness({ db: withoutActivityTable(env.DB), now: DIGEST_NOW });

    await runScheduled("*/10 * * * *", deps);

    expect(jobEntries(log), "job log entries").toEqual([]);
    expect((await readDigestRun(env.DB))?.getTime(), "run time").toBe(DIGEST_NOW.getTime());
    expect(telegram.requests, "Telegram requests").toEqual([]);
  });

  it("runScheduled leaves the digest row pending after a full retry of 10 rows answered 429 twice, and the next run sends it", async () => {
    await configureDigest();
    await addStar();
    const rows = await insertDueRows(10, 4);
    const answers: TelegramAnswers = { sendMessage: [...Array.from({ length: 20 }, () => TOO_MANY), ACCEPTED] };
    const first = harness({ answers, now: DIGEST_NOW });

    await runScheduled("*/10 * * * *", first.deps);

    expect(first.telegram.requests, "Telegram requests of the first run").toHaveLength(20);
    expect(await digestRows(), "digest row written pending and unsent").toEqual([{ status: "pending", attempts: 0 }]);
    expect(await activityCount(), "events are counted into the digest").toBe(0);
    expect(await Promise.all(rows.map((id) => statusOf(id))), "the ten rows").toEqual(rows.map(() => "failed"));
    const nextRun = new Date("2026-10-21T13:10:00Z");
    const second = harness({ now: nextRun });

    await runScheduled("*/10 * * * *", second.deps);

    expect(await digestRows(), "digest row after the next run").toEqual([{ status: "sent", attempts: 1 }]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM outbox").first(), "no second digest").toEqual({ n: 11 });
  });

  it("runScheduled does not run the digest for the release schedule", async () => {
    await configureDigest();
    await addStar();
    const { deps } = harness({ now: DIGEST_NOW });

    await runScheduled("17 5 * * *", deps);

    expect(await activityCount(), "activity rows").toBe(1);
    expect((await readDigestRun(env.DB))?.getTime(), "run time").toBe(DIGEST_PREVIOUS.getTime());
    expect(await digestRows(), "digest rows").toEqual([]);
  });
});
