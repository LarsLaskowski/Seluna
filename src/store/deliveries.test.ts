import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { isKnownDelivery, recordDelivery } from "./deliveries";
import { readLastDelivery } from "./meta";
import type { StoredNotification } from "../notification";
import { applyMigrations } from "../../test/d1";

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM deliveries"),
    env.DB.prepare("DELETE FROM outbox"),
    env.DB.prepare("DELETE FROM meta WHERE key = 'last_delivery'"),
  ]);
});

const RECEIVED_AT = new Date(1_792_240_440_000);

async function count(table: "deliveries" | "outbox"): Promise<unknown> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first();
  return row?.n;
}

async function insertDelivery(id: string): Promise<void> {
  await env.DB.prepare("INSERT INTO deliveries (id, event, received_at) VALUES (?1, 'ping', 1000)").bind(id).run();
}

describe("isKnownDelivery", () => {
  it("isKnownDelivery returns true only for a recorded id", async () => {
    await insertDelivery("known-1");

    const known = await isKnownDelivery(env.DB, "known-1");
    const unknown = await isKnownDelivery(env.DB, "other-2");

    expect(known, "recorded id").toBe(true);
    expect(unknown, "unrecorded id").toBe(false);
  });
});

/** A stored notification whose title is `title`. */
function notificationTitled(title: string): StoredNotification {
  return { title, repository: "o/r", number: 1, subject: "S", context: "C" };
}

describe("recordDelivery", () => {
  it("recordDelivery stores the delivery, its outbox rows and last_delivery and returns the row ids in order", async () => {
    const messages = [
      { notification: notificationTitled("first"), buttonUrl: "https://github.com/o/r/pull/1", silent: false },
      { notification: notificationTitled("second"), buttonUrl: undefined, silent: true },
    ];

    const result = await recordDelivery(
      env.DB,
      { id: "new-1", event: "pull_request", receivedAt: RECEIVED_AT },
      messages,
    );

    expect(result.kind, "result kind").toBe("recorded");
    const ids = result.kind === "recorded" ? result.outboxIds : [];
    expect(ids.length, "number of ids").toBe(2);
    const { results } = await env.DB.prepare(
      "SELECT id, text, button_url, silent, created_at FROM outbox ORDER BY id",
    ).all();
    expect(
      results.map((row) => row.id),
      "ids in insertion order",
    ).toEqual(ids);
    expect(results, "rows").toEqual([
      {
        id: ids[0],
        text: '{"title":"first","repository":"o/r","number":1,"subject":"S","context":"C"}',
        button_url: "https://github.com/o/r/pull/1",
        silent: 0,
        created_at: 1_792_240_440_000,
      },
      {
        id: ids[1],
        text: '{"title":"second","repository":"o/r","number":1,"subject":"S","context":"C"}',
        button_url: null,
        silent: 1,
        created_at: 1_792_240_440_000,
      },
    ]);
    expect(await env.DB.prepare("SELECT * FROM deliveries").first(), "delivery row").toEqual({
      id: "new-1",
      event: "pull_request",
      received_at: 1_792_240_440_000,
    });
    expect((await readLastDelivery(env.DB))?.getTime(), "last_delivery").toBe(1_792_240_440_000);
  });

  it("recordDelivery returns duplicate and writes no outbox row and no last_delivery for a recorded id", async () => {
    await insertDelivery("known-1");

    const result = await recordDelivery(env.DB, { id: "known-1", event: "ping", receivedAt: RECEIVED_AT }, [
      { notification: notificationTitled("never stored"), buttonUrl: undefined, silent: false },
    ]);

    expect(result, "result").toEqual({ kind: "duplicate" });
    expect(await count("outbox"), "outbox rows").toBe(0);
    expect(await count("deliveries"), "deliveries rows").toBe(1);
    expect(await readLastDelivery(env.DB), "last_delivery").toBeUndefined();
  });

  it("recordDelivery rejects when the batch fails for a new delivery id", async () => {
    const failingBatch: D1Database = {
      prepare: (query: string) => env.DB.prepare(query),
      batch: () => Promise.reject(new Error("The batch failed")),
      exec: () => Promise.reject(new Error("Not supported")),
      dump: () => Promise.reject(new Error("Not supported")),
      withSession: () => {
        throw new Error("Not supported");
      },
    };

    const recording = recordDelivery(failingBatch, { id: "new-9", event: "ping", receivedAt: RECEIVED_AT }, [
      { notification: notificationTitled("never stored"), buttonUrl: undefined, silent: false },
    ]);

    await expect(recording, "result").rejects.toThrow("The batch failed");
    expect(await count("deliveries"), "deliveries rows").toBe(0);
  });
});
