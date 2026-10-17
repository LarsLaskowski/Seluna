import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markAttempted, markSent, outboxInsert } from "./outbox";
import { applyMigrations } from "../../test/d1";

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.prepare("DELETE FROM outbox").run();
});

async function insertRaw(status: string, attempts: number): Promise<number> {
  const row = await env.DB.prepare(
    "INSERT INTO outbox (text, button_url, silent, attempts, status, created_at) VALUES ('t', NULL, 0, ?1, ?2, 1000) RETURNING id",
  )
    .bind(attempts, status)
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
