/** The tables the migrations under `migrations/` create; the store modules read and write only these. */
export const SCHEMA_TABLES: readonly string[] = [
  "settings",
  "secrets",
  "deliveries",
  "outbox",
  "token_cache",
  "meta",
  "activity",
];

/** The statement `readSchemaState` sends: the names of all tables in `sqlite_master`. */
export const SCHEMA_TABLES_SQL = "SELECT name FROM sqlite_master WHERE type = 'table'";

/** Whether the database has the schema's tables: `complete` when every table of `SCHEMA_TABLES` exists. */
export type SchemaState = "complete" | "tables-missing";

/** The state for the `name` values of the `sqlite_master` table rows; a value that is not a string is ignored. */
export function schemaStateOf(tableNames: readonly unknown[]): SchemaState {
  const present = new Set(tableNames.filter((name): name is string => typeof name === "string"));
  return SCHEMA_TABLES.every((table) => present.has(table)) ? "complete" : "tables-missing";
}

/** Reads the table names from `sqlite_master` and returns their state. D1 errors are not caught. */
export async function readSchemaState(db: D1Database): Promise<SchemaState> {
  const { results } = await db.prepare(SCHEMA_TABLES_SQL).all();
  return schemaStateOf(results.map((row) => row.name));
}
