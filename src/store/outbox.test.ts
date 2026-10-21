import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { failExhaustedRows, finishedRowsDelete, markAttempted, markSent, outboxInsert, readDueRows } from "./outbox";
import { applyMigrations } from "../../test/d1";

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.prepare("DELETE FROM outbox").run();
});

async function insertRaw(status: string, attempts: number, createdAt = 1000): Promise<number> {
  const row = await env.DB.prepare(
    "INSERT INTO outbox (text, button_url, silent, attempts, status, created_at) VALUES ('t', NULL, 0, ?1, ?2, ?3) RETURNING id",
  )
    .bind(attempts, status, createdAt)
    .first();
  const id = row?.id;
  if (typeof id !== "number") {
    throw new TypeError("The insert returned no id");
  }
  return id;
}

async function rowOf(id: number): Promise<Record<string, unknown> | null> {
  return env.DB.prepare("SELECT * FROM outbox WHERE id = ?1").bind(id).first();
}

describe("outboxInsert", () => {
  it("outboxInsert stores text, button URL, silent and created_at and returns the id", async () => {
    const createdAt = new Date(1_792_240_440_000);
    const row = { text: "<b>T</b>", buttonUrl: "https://github.com/o/r", silent: true };

    const [result] = await env.DB.batch<{ id: number }>([outboxInsert(env.DB, row, createdAt)]);

    const id = result?.results[0]?.id;
    expect(id, "returned id").toEqual(expect.any(Number));
    expect(await rowOf(Number(id)), "stored row").toEqual({
      id,
      text: "<b>T</b>",
      button_url: "https://github.com/o/r",
      silent: 1,
      attempts: 0,
      status: "pending",
      created_at: 1_792_240_440_000,
    });
  });
});

describe("markSent", () => {
  it("markSent marks a pending row sent and counts the attempt", async () => {
    const id = await insertRaw("pending", 2);

    await markSent(env.DB, id);

    expect(await rowOf(id), "row").toMatchObject({ status: "sent", attempts: 3 });
  });
});

describe("markAttempted", () => {
  it("markAttempted counts the attempt and keeps the row pending", async () => {
    const id = await insertRaw("pending", 2);

    await markAttempted(env.DB, id);

    expect(await rowOf(id), "row").toMatchObject({ status: "pending", attempts: 3 });
  });
});

describe("the updates of a row that is no longer pending", () => {
  it.each([
    { name: "markSent", update: markSent, status: "sent" },
    { name: "markSent", update: markSent, status: "failed" },
    { name: "markAttempted", update: markAttempted, status: "sent" },
    { name: "markAttempted", update: markAttempted, status: "failed" },
  ])("$name changes no row whose status is $status", async ({ update, status }) => {
    const id = await insertRaw(status, 4);

    await update(env.DB, id);

    expect(await rowOf(id), "row").toMatchObject({ status, attempts: 4 });
  });
});

describe("markAttempted and the fifth attempt", () => {
  it("markAttempted marks a pending row with 4 attempts failed with 5 and returns failed", async () => {
    const id = await insertRaw("pending", 4);

    const outcome = await markAttempted(env.DB, id);

    expect(outcome, "outcome").toBe("failed");
    expect(await rowOf(id), "row").toMatchObject({ status: "failed", attempts: 5 });
  });

  it("markAttempted keeps a pending row with 3 attempts pending with 4 and returns pending", async () => {
    const id = await insertRaw("pending", 3);

    const outcome = await markAttempted(env.DB, id);

    expect(outcome, "outcome").toBe("pending");
    expect(await rowOf(id), "row").toMatchObject({ status: "pending", attempts: 4 });
  });

  it.each(["sent", "failed"])("markAttempted returns unchanged for a %s row", async (status) => {
    const id = await insertRaw(status, 4);

    const outcome = await markAttempted(env.DB, id);

    expect(outcome, "outcome").toBe("unchanged");
  });

  it("markAttempted returns unchanged for an id without a row", async () => {
    const outcome = await markAttempted(env.DB, 987_654);

    expect(outcome, "outcome").toBe("unchanged");
  });
});

/** Inserts one pending row per entry of `createdAts` with `attempts` attempts; the ids in the order of the entries. */
async function insertPendingRows(attempts: number, createdAts: readonly number[]): Promise<readonly number[]> {
  return Promise.all(createdAts.map((createdAt) => insertRaw("pending", attempts, createdAt)));
}

describe("failExhaustedRows", () => {
  it("failExhaustedRows marks at most the limit of rows failed, oldest first, and returns their ids", async () => {
    const createdAts = [1100, 1090, 1080, 1070, 1060, 1050, 1040, 1030, 1020, 1010, 1000];
    const ids = await insertPendingRows(5, createdAts);

    const failed = await failExhaustedRows(env.DB, 10);

    expect(failed, "returned ids, oldest first").toEqual(ids.slice(1).reverse());
    expect(await rowOf(ids[0] ?? 0), "the newest row").toMatchObject({ status: "pending", attempts: 5 });
  });

  it("failExhaustedRows orders rows written at the same time by id", async () => {
    const ids = await insertPendingRows(5, [1000, 1000, 1000]);

    const failed = await failExhaustedRows(env.DB, 2);

    expect(failed, "returned ids").toEqual(ids.slice(0, 2));
  });

  it("failExhaustedRows marks a row with more than 5 attempts and keeps its attempts", async () => {
    const id = await insertRaw("pending", 7);

    const failed = await failExhaustedRows(env.DB, 10);

    expect(failed, "returned ids").toEqual([id]);
    expect(await rowOf(id), "row").toMatchObject({ status: "failed", attempts: 7 });
  });

  it("failExhaustedRows leaves rows under 5 attempts and rows that are not pending", async () => {
    const under = await insertRaw("pending", 4);
    const sent = await insertRaw("sent", 5);
    const failedRow = await insertRaw("failed", 5);

    const failed = await failExhaustedRows(env.DB, 10);

    expect(failed, "returned ids").toEqual([]);
    expect(await rowOf(under), "row with 4 attempts").toMatchObject({ status: "pending", attempts: 4 });
    expect(await rowOf(sent), "sent row").toMatchObject({ status: "sent", attempts: 5 });
    expect(await rowOf(failedRow), "failed row").toMatchObject({ status: "failed", attempts: 5 });
  });
});

describe("readDueRows", () => {
  it("readDueRows returns at most the limit of rows, oldest first by the time written, then by id", async () => {
    const ids = await insertPendingRows(0, [3000, 2000, 2000, 1000, 4000]);

    const rows = await readDueRows(env.DB, new Date(10_000), 4);

    expect(
      rows.map((row) => row.id),
      "ids",
    ).toEqual([ids[3], ids[1], ids[2], ids[0]]);
  });

  it("readDueRows returns only rows written strictly before the bound", async () => {
    const before = await insertRaw("pending", 0, 59_999);
    await insertRaw("pending", 0, 60_000);
    await insertRaw("pending", 0, 60_001);

    const rows = await readDueRows(env.DB, new Date(60_000), 10);

    expect(
      rows.map((row) => row.id),
      "ids",
    ).toEqual([before]);
  });

  it("readDueRows skips rows with 5 or more attempts and rows that are not pending", async () => {
    const due = await insertRaw("pending", 4);
    await insertRaw("pending", 5);
    await insertRaw("pending", 6);
    await insertRaw("sent", 1);
    await insertRaw("failed", 5);

    const rows = await readDueRows(env.DB, new Date(10_000), 10);

    expect(
      rows.map((row) => row.id),
      "ids",
    ).toEqual([due]);
  });

  it("readDueRows maps the columns to the fields of an OutboxRow", async () => {
    const withButton = await env.DB.prepare(
      "INSERT INTO outbox (text, button_url, silent, created_at) VALUES ('<b>x</b>', 'https://github.com/o/r', 1, 1000) RETURNING id",
    ).first();
    const plain = await insertRaw("pending", 0, 2000);

    const rows = await readDueRows(env.DB, new Date(10_000), 10);

    expect(rows, "rows").toEqual([
      { id: withButton?.id, text: "<b>x</b>", buttonUrl: "https://github.com/o/r", silent: true },
      { id: plain, text: "t", buttonUrl: undefined, silent: false },
    ]);
  });
});

describe("finishedRowsDelete", () => {
  async function remainingIds(): Promise<readonly unknown[]> {
    const result = await env.DB.prepare("SELECT id FROM outbox ORDER BY id").all();
    return result.results.map((row) => row.id);
  }

  it("finishedRowsDelete deletes sent and failed rows written before the bound and keeps the others", async () => {
    await insertRaw("sent", 1, 999);
    await insertRaw("failed", 5, 999);
    const atBound = await insertRaw("sent", 1, 1000);
    const pendingOld = await insertRaw("pending", 0, 1);
    const newer = await insertRaw("failed", 5, 1001);

    await env.DB.batch([finishedRowsDelete(env.DB, new Date(1000), 1000)]);

    expect(await remainingIds(), "remaining ids").toEqual([atBound, pendingOld, newer]);
  });

  it("finishedRowsDelete deletes at most the limit of rows, the oldest first", async () => {
    const ids = await Promise.all([3000, 1000, 2000, 4000].map((createdAt) => insertRaw("sent", 1, createdAt)));

    await env.DB.batch([finishedRowsDelete(env.DB, new Date(10_000), 3)]);

    expect(await remainingIds(), "remaining ids").toEqual([ids[3]]);
  });
});
