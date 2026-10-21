import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { CLEANUP_LIMIT, cleanUpRows, DELIVERY_RETENTION_MS, OUTBOX_RETENTION_MS } from "./cleanup";
import { applyMigrations } from "../test/d1";

const STARTED_AT = new Date("2026-10-21T05:17:00Z");
const NOW = STARTED_AT.getTime();
const IV = "0123456789abcdef";

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM deliveries"),
    env.DB.prepare("DELETE FROM outbox"),
    env.DB.prepare("DELETE FROM token_cache"),
  ]);
});

async function insertDelivery(id: string, receivedAt: number): Promise<void> {
  await env.DB.prepare("INSERT INTO deliveries (id, event, received_at) VALUES (?1, 'ping', ?2)")
    .bind(id, receivedAt)
    .run();
}

async function insertOutbox(status: string, createdAt: number): Promise<void> {
  await env.DB.prepare("INSERT INTO outbox (text, status, created_at) VALUES ('t', ?1, ?2)")
    .bind(status, createdAt)
    .run();
}

async function insertToken(installationId: number, expiresAt: number): Promise<void> {
  await env.DB.prepare("INSERT INTO token_cache (installation_id, iv, ciphertext, expires_at) VALUES (?1, ?2, 'c', ?3)")
    .bind(installationId, IV, expiresAt)
    .run();
}

async function column(query: string, name: string): Promise<readonly unknown[]> {
  const result = await env.DB.prepare(query).all();
  return result.results.map((row) => row[name]);
}

const deliveryIds = (): Promise<readonly unknown[]> => column("SELECT id FROM deliveries ORDER BY id", "id");
const outboxTimes = (): Promise<readonly unknown[]> =>
  column("SELECT created_at FROM outbox ORDER BY created_at, id", "created_at");
const tokenIds = (): Promise<readonly unknown[]> =>
  column("SELECT installation_id FROM token_cache ORDER BY installation_id", "installation_id");

/** Inserts `count` rows of `table` whose time is `oldest` plus 0 .. `count - 1` ms. */
async function seedBulk(table: "deliveries" | "outbox" | "token_cache", oldest: number, count: number): Promise<void> {
  const rows = "WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?2) ";
  const queries = {
    deliveries: `${rows} INSERT INTO deliveries (id, event, received_at) SELECT 'd' || i, 'ping', ?1 + i FROM n`,
    outbox: `${rows} INSERT INTO outbox (text, status, created_at) SELECT 't', 'sent', ?1 + i FROM n`,
    token_cache: `${rows} INSERT INTO token_cache (installation_id, iv, ciphertext, expires_at) SELECT i + 1, '${IV}', 'c', ?1 + i FROM n`,
  };
  await env.DB.prepare(queries[table])
    .bind(oldest, count - 1)
    .run();
}

describe("cleanUpRows deliveries", () => {
  it("cleanUpRows deletes deliveries received 1 ms over 7 days ago and keeps one exactly 7 days old", async () => {
    await insertDelivery("old", NOW - DELIVERY_RETENTION_MS - 1);
    await insertDelivery("edge", NOW - DELIVERY_RETENTION_MS);
    await insertDelivery("new", NOW);

    await cleanUpRows(env.DB, STARTED_AT);

    expect(await deliveryIds(), "remaining deliveries").toEqual(["edge", "new"]);
  });

  it("cleanUpRows deletes the 1,000 oldest of 1,001 old deliveries", async () => {
    await seedBulk("deliveries", NOW - DELIVERY_RETENTION_MS - 5000, CLEANUP_LIMIT + 1);

    await cleanUpRows(env.DB, STARTED_AT);

    expect(await deliveryIds(), "remaining deliveries").toEqual(["d1000"]);
  });
});

describe("cleanUpRows outbox", () => {
  it("cleanUpRows deletes sent and failed rows 1 ms over 30 days old and keeps the edge, newer and pending rows", async () => {
    const old = NOW - OUTBOX_RETENTION_MS - 1;
    await insertOutbox("sent", old);
    await insertOutbox("failed", old);
    await insertOutbox("sent", NOW - OUTBOX_RETENTION_MS);
    await insertOutbox("failed", NOW - OUTBOX_RETENTION_MS);
    await insertOutbox("pending", NOW - 365 * 86_400_000);
    await insertOutbox("sent", NOW);

    await cleanUpRows(env.DB, STARTED_AT);

    expect(await outboxTimes(), "remaining created_at").toEqual([
      NOW - 365 * 86_400_000,
      NOW - OUTBOX_RETENTION_MS,
      NOW - OUTBOX_RETENTION_MS,
      NOW,
    ]);
  });

  it("cleanUpRows deletes the 1,000 oldest of 1,001 old outbox rows", async () => {
    const oldest = NOW - OUTBOX_RETENTION_MS - 5000;
    await seedBulk("outbox", oldest, CLEANUP_LIMIT + 1);

    await cleanUpRows(env.DB, STARTED_AT);

    expect(await outboxTimes(), "remaining created_at").toEqual([oldest + CLEANUP_LIMIT]);
  });
});

describe("cleanUpRows token_cache", () => {
  it("cleanUpRows deletes tokens that expired 1 ms ago and keeps one expiring now or later", async () => {
    await insertToken(1, NOW - 1);
    await insertToken(2, NOW);
    await insertToken(3, NOW + 1);

    await cleanUpRows(env.DB, STARTED_AT);

    expect(await tokenIds(), "remaining installations").toEqual([2, 3]);
  });

  it("cleanUpRows deletes the 1,000 earliest expired of 1,001 expired tokens", async () => {
    await seedBulk("token_cache", NOW - 5000 - CLEANUP_LIMIT, CLEANUP_LIMIT + 1);

    await cleanUpRows(env.DB, STARTED_AT);

    expect(await tokenIds(), "remaining installations").toEqual([CLEANUP_LIMIT + 1]);
  });
});

describe("cleanUpRows across tables", () => {
  it("cleanUpRows applies the limit to each table separately", async () => {
    await seedBulk("deliveries", NOW - DELIVERY_RETENTION_MS - 5000, CLEANUP_LIMIT + 1);
    await seedBulk("outbox", NOW - OUTBOX_RETENTION_MS - 5000, CLEANUP_LIMIT + 1);
    await seedBulk("token_cache", NOW - 5000 - CLEANUP_LIMIT, CLEANUP_LIMIT + 1);

    await cleanUpRows(env.DB, STARTED_AT);

    expect(
      [(await deliveryIds()).length, (await outboxTimes()).length, (await tokenIds()).length],
      "remaining rows of deliveries, outbox, token_cache",
    ).toEqual([1, 1, 1]);
  });
});
