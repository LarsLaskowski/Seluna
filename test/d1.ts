import { applyD1Migrations } from "cloudflare:test";
import type { D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { SCHEMA_TABLES_SQL } from "../src/store/schema";

function isMigration(value: unknown): value is D1Migration {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "queries" in value &&
    Array.isArray(value.queries) &&
    value.queries.every((query: unknown) => typeof query === "string")
  );
}

/** The migrations read from `migrations/` by `vitest.config.ts`, narrowed from the test environment. */
function testMigrations(): D1Migration[] {
  const migrations: unknown = "TEST_MIGRATIONS" in env ? env.TEST_MIGRATIONS : undefined;
  if (!Array.isArray(migrations) || !migrations.every(isMigration)) {
    throw new Error("TEST_MIGRATIONS is not bound by vitest.config.ts");
  }
  return migrations;
}

/** Applies every migration under `migrations/` to `db` (idempotent). */
export async function applyMigrations(db: D1Database): Promise<void> {
  await applyD1Migrations(db, testMigrations());
}

/**
 * The second database binding of `vitest.config.ts`: a database that no test file migrates, so it has no tables
 * unless a test of the same file applies the migrations to it. It stays empty because the test pool isolates the
 * storage per test file; `test/migrations.test.ts` migrates it, the other files use it as a database without tables.
 */
export function migrationTestDb(): D1Database {
  const db: unknown = "MIGRATION_TEST_DB" in env ? env.MIGRATION_TEST_DB : undefined;
  if (typeof db !== "object" || db === null || !("prepare" in db) || !("batch" in db)) {
    throw new Error("MIGRATION_TEST_DB is not bound by vitest.config.ts");
  }
  // A cast after the runtime check above: the binding is declared only in vitest.config.ts, not in Env.
  return db as D1Database;
}

/** A `D1Database` whose every member throws: passed to code that must not touch the database. */
export function unusedDb(): D1Database {
  const fail = (): never => {
    throw new Error("The database must not be used");
  };
  return { prepare: fail, batch: fail, exec: fail, dump: fail, withSession: fail };
}

/**
 * A `D1Database` whose `prepare` passes exactly the statement `SCHEMA_TABLES_SQL` to `db` and throws for every other
 * statement; every other member throws.
 */
export function schemaOnlyDb(db: D1Database): D1Database {
  const fail = (): never => {
    throw new Error("The database may only answer the schema check");
  };
  return {
    prepare: (query: string) => (query === SCHEMA_TABLES_SQL ? db.prepare(query) : fail()),
    batch: fail,
    exec: fail,
    dump: fail,
    withSession: fail,
  };
}

/**
 * A `D1Database` that reads like `db` but whose `prepare` throws for every statement that does not start with
 * `SELECT`, and whose `batch`, `exec`, `dump` and `withSession` throw: a database whose writes fail.
 */
export function writeFailingDb(db: D1Database): D1Database {
  const fail = (): never => {
    throw new Error("The database may only be read");
  };
  return {
    prepare: (query: string) => (/^\s*SELECT\b/i.test(query) ? db.prepare(query) : fail()),
    batch: fail,
    exec: fail,
    dump: fail,
    withSession: fail,
  };
}
