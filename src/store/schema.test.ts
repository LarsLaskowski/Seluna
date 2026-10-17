import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { readSchemaState, SCHEMA_TABLES, schemaStateOf } from "./schema";
import { applyMigrations, migrationTestDb, unusedDb } from "../../test/d1";

describe("schemaStateOf", () => {
  it("schemaStateOf returns complete when every schema table is listed", () => {
    const state = schemaStateOf([...SCHEMA_TABLES]);

    expect(state, "state").toBe("complete");
  });

  it("schemaStateOf returns complete when other tables are listed beside the schema tables", () => {
    const state = schemaStateOf(["d1_migrations", ...SCHEMA_TABLES, "sqlite_sequence", "_cf_KV"]);

    expect(state, "state").toBe("complete");
  });

  it.each(SCHEMA_TABLES)("schemaStateOf returns tables-missing without %s", (missing) => {
    const state = schemaStateOf(SCHEMA_TABLES.filter((name) => name !== missing));

    expect(state, "state").toBe("tables-missing");
  });

  it("schemaStateOf returns tables-missing for no tables", () => {
    const state = schemaStateOf([]);

    expect(state, "state").toBe("tables-missing");
  });

  it("schemaStateOf ignores names that are not strings", () => {
    const state = schemaStateOf([...SCHEMA_TABLES.map((name) => ({ name })), 1, 2, null]);

    expect(state, "state").toBe("tables-missing");
  });
});

describe("readSchemaState", () => {
  it("readSchemaState returns complete for a migrated database", async () => {
    await applyMigrations(env.DB);

    const state = await readSchemaState(env.DB);

    expect(state, "state").toBe("complete");
  });

  it("readSchemaState returns tables-missing for a database without tables", async () => {
    const state = await readSchemaState(migrationTestDb());

    expect(state, "state").toBe("tables-missing");
  });

  it("readSchemaState rejects when D1 fails", async () => {
    await expect(readSchemaState(unusedDb()), "result").rejects.toThrow("The database must not be used");
  });
});

const byName = (a: unknown, b: unknown): number => String(a).localeCompare(String(b));

describe("SCHEMA_TABLES", () => {
  it("SCHEMA_TABLES lists exactly the tables the migrations create", async () => {
    await applyMigrations(env.DB);

    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
    ).all();

    expect(results.map((row) => row.name).sort(byName), "created tables").toEqual([...SCHEMA_TABLES].sort(byName));
  });
});
