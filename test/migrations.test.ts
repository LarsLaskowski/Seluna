import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, migrationTestDb } from "./d1";

interface ExpectedColumn {
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: string | null;
  readonly pk: number;
}

function column(name: string, type: string, notnull: number, dflt_value: string | null, pk: number): ExpectedColumn {
  return { name, type, notnull, dflt_value, pk };
}

/** The tables of the storage area, with the `PRAGMA table_info` rows SQLite reports for the schema in the plan. */
const TABLES: readonly (readonly [string, readonly ExpectedColumn[]])[] = [
  ["settings", [column("key", "TEXT", 1, null, 1), column("value", "TEXT", 1, null, 0)]],
  [
    "secrets",
    [column("key", "TEXT", 1, null, 1), column("iv", "TEXT", 1, null, 0), column("ciphertext", "TEXT", 1, null, 0)],
  ],
  [
    "deliveries",
    [
      column("id", "TEXT", 1, null, 1),
      column("event", "TEXT", 1, null, 0),
      column("received_at", "INTEGER", 1, null, 0),
    ],
  ],
  [
    "outbox",
    [
      column("id", "INTEGER", 0, null, 1),
      column("text", "TEXT", 1, null, 0),
      column("button_url", "TEXT", 0, null, 0),
      column("silent", "INTEGER", 1, "0", 0),
      column("attempts", "INTEGER", 1, "0", 0),
      column("status", "TEXT", 1, "'pending'", 0),
      column("created_at", "INTEGER", 1, null, 0),
    ],
  ],
  [
    "token_cache",
    [
      column("installation_id", "INTEGER", 1, null, 1),
      column("iv", "TEXT", 1, null, 0),
      column("ciphertext", "TEXT", 1, null, 0),
      column("expires_at", "INTEGER", 1, null, 0),
    ],
  ],
  ["meta", [column("key", "TEXT", 1, null, 1), column("value", "TEXT", 1, null, 0)]],
];

/** SQLite's and D1's internal tables are not part of the schema under test. */
const USER_TABLES_SQL =
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'";

async function names(sql: string): Promise<unknown[]> {
  const result = await migrationTestDb().prepare(sql).all();
  return result.results.map((row) => row.name);
}

async function run(sql: string, ...values: unknown[]): Promise<unknown> {
  return migrationTestDb()
    .prepare(sql)
    .bind(...values)
    .run();
}

// This test comes first on purpose: no other test file uses MIGRATION_TEST_DB, and the emptiness assertion fails
// the run when the binding is shared with another database.
it("migrations apply to an empty database", async () => {
  expect(await names(USER_TABLES_SQL), "tables before the migrations").toEqual([]);

  await applyMigrations(migrationTestDb());

  expect(await names("SELECT name FROM d1_migrations ORDER BY id"), "applied migrations").toEqual([
    "0001_initial_schema.sql",
  ]);
});

describe("applied migrations", () => {
  beforeEach(async () => {
    await applyMigrations(migrationTestDb());
  });

  it("migrations create exactly the tables settings, secrets, deliveries, outbox, token_cache and meta", async () => {
    const tables = await names(`${USER_TABLES_SQL} AND name <> 'd1_migrations' ORDER BY name`);

    expect(tables, "tables").toEqual(["deliveries", "meta", "outbox", "secrets", "settings", "token_cache"]);
  });

  it.each(TABLES)("%s has the columns of the storage area", async (table, columns) => {
    const result = await migrationTestDb().prepare(`PRAGMA table_info(${table})`).all();

    const actual = result.results.map((row) => ({
      name: row.name,
      type: row.type,
      notnull: row.notnull,
      dflt_value: row.dflt_value,
      pk: row.pk,
    }));
    expect(actual, `columns of ${table}`).toEqual(columns);
  });

  it("migrations create the indexes deliveries_received_at and outbox_status_created_at", async () => {
    const deliveriesIndexes = await names("PRAGMA index_list(deliveries)");
    const outboxIndexes = await names("PRAGMA index_list(outbox)");
    const deliveriesColumns = await names("PRAGMA index_info(deliveries_received_at)");
    const outboxColumns = await names("PRAGMA index_info(outbox_status_created_at)");

    expect(deliveriesIndexes, "indexes of deliveries").toContain("deliveries_received_at");
    expect(outboxIndexes, "indexes of outbox").toContain("outbox_status_created_at");
    expect(deliveriesColumns, "columns of deliveries_received_at").toEqual(["received_at"]);
    expect(outboxColumns, "columns of outbox_status_created_at").toEqual(["status", "created_at"]);
  });

  it("secrets rejects an iv that is not 16 characters", async () => {
    const insert = run("INSERT INTO secrets (key, iv, ciphertext) VALUES (?1, ?2, ?3)", "k", "a".repeat(15), "c");

    await expect(insert, "insert with a 15-character iv").rejects.toThrow(/CHECK constraint failed/);
  });

  it("token_cache rejects an iv that is not 16 characters", async () => {
    const insert = run(
      "INSERT INTO token_cache (installation_id, iv, ciphertext, expires_at) VALUES (?1, ?2, ?3, ?4)",
      1,
      "a".repeat(17),
      "c",
      0,
    );

    await expect(insert, "insert with a 17-character iv").rejects.toThrow(/CHECK constraint failed/);
  });

  it("outbox rejects a status other than pending, sent or failed", async () => {
    const insert = run("INSERT INTO outbox (text, status, created_at) VALUES (?1, ?2, ?3)", "t", "queued", 0);

    await expect(insert, "insert with status queued").rejects.toThrow(/CHECK constraint failed/);
  });

  it("outbox rejects silent other than 0 or 1", async () => {
    const insert = run("INSERT INTO outbox (text, silent, created_at) VALUES (?1, ?2, ?3)", "t", 2, 0);

    await expect(insert, "insert with silent 2").rejects.toThrow(/CHECK constraint failed/);
  });

  it("outbox rejects a negative attempts count", async () => {
    const insert = run("INSERT INTO outbox (text, attempts, created_at) VALUES (?1, ?2, ?3)", "t", -1, 0);

    await expect(insert, "insert with attempts -1").rejects.toThrow(/CHECK constraint failed/);
  });

  it("outbox fills silent 0, attempts 0 and status pending by default", async () => {
    await run("INSERT INTO outbox (text, created_at) VALUES (?1, ?2)", "default-row", 0);

    const row = await migrationTestDb()
      .prepare("SELECT silent, attempts, status FROM outbox WHERE text = ?1")
      .bind("default-row")
      .first();

    expect(row, "defaulted row").toEqual({ silent: 0, attempts: 0, status: "pending" });
  });
});
