import { decrypt, encrypt } from "../crypto";

/** The credentials kept in the `secrets` table. */
export type SecretName = "github_app_id" | "github_private_key" | "github_webhook_secret";

/** Outcome of reading one credential. */
export type SecretReadResult =
  | { readonly kind: "ok"; readonly value: string }
  | { readonly kind: "missing" }
  | { readonly kind: "secret-changed" }
  | { readonly kind: "corrupt" };

/** Outcome of writing one credential. */
export type SecretWriteResult =
  { readonly kind: "ok" } | { readonly kind: "secret-changed" } | { readonly kind: "corrupt" };

/** Outcome of comparing the stored key check value with a key. */
export type KeyCheckResult = "unset" | "match" | "changed" | "corrupt";

/** `meta` key of the key check value. */
export const KEY_CHECK_META_KEY = "key_check";
/** The text the key check value encrypts. */
export const KEY_CHECK_PLAINTEXT = "seluna/key-check/v1";

const KEY_CHECK_CONTEXT = "meta/key_check";
const WRITE_ATTEMPTS = 2;

const SELECT_KEY_CHECK = "SELECT value FROM meta WHERE key = ?1";
const SELECT_SECRET = "SELECT iv, ciphertext FROM secrets WHERE key = ?1";
const INSERT_KEY_CHECK =
  "INSERT INTO meta (key, value) SELECT ?1, ?2 WHERE NOT EXISTS (SELECT 1 FROM secrets) " +
  "ON CONFLICT (key) DO NOTHING";
const UPSERT_SECRET =
  "INSERT INTO secrets (key, iv, ciphertext) SELECT ?1, ?2, ?3 " +
  "WHERE EXISTS (SELECT 1 FROM meta WHERE key = ?4 AND value = ?5) " +
  "ON CONFLICT (key) DO UPDATE SET iv = excluded.iv, ciphertext = excluded.ciphertext";

interface KeyCheckEvaluation {
  readonly result: KeyCheckResult;
  /** The stored key check text; set only when `result` is `match`. */
  readonly stored?: string;
}

/** The `value` column of a row from D1, or `undefined` for no row; `null` for a row that is not a string. */
function valueOf(row: unknown): string | null | undefined {
  if (row === null || row === undefined) {
    return undefined;
  }
  const value: unknown = typeof row === "object" && "value" in row ? row.value : undefined;
  return typeof value === "string" ? value : null;
}

const KEY_CHECK_IV = /^[A-Za-z0-9+/]{16}$/;
const KEY_CHECK_CIPHERTEXT = /^[A-Za-z0-9+/]+={0,2}$/;
const MIN_KEY_CHECK_CIPHERTEXT_LENGTH = 24;

/** Whether the two parts of a stored key check value look like base64 of a sealed value. */
function isWellFormedKeyCheck(iv: string, ciphertext: string): boolean {
  return (
    KEY_CHECK_IV.test(iv) &&
    KEY_CHECK_CIPHERTEXT.test(ciphertext) &&
    ciphertext.length % 4 === 0 &&
    ciphertext.length >= MIN_KEY_CHECK_CIPHERTEXT_LENGTH
  );
}

async function evaluateKeyCheck(key: CryptoKey, row: unknown): Promise<KeyCheckEvaluation> {
  const value = valueOf(row);
  if (value === undefined) {
    return { result: "unset" };
  }
  const parts = value?.split(".");
  const iv = parts?.[0];
  const ciphertext = parts?.[1];
  if (value === null || parts?.length !== 2 || iv === undefined || ciphertext === undefined) {
    return { result: "corrupt" };
  }
  if (!isWellFormedKeyCheck(iv, ciphertext)) {
    return { result: "corrupt" };
  }
  const plaintext = await decrypt(key, { iv, ciphertext }, KEY_CHECK_CONTEXT);
  if (plaintext === undefined) {
    return { result: "changed" };
  }
  return plaintext === KEY_CHECK_PLAINTEXT ? { result: "match", stored: value } : { result: "corrupt" };
}

/** Compares the stored key check value with `key` (the key from `keyFromEnv`). */
export async function checkKey(db: D1Database, key: CryptoKey): Promise<KeyCheckResult> {
  const row = await db.prepare(SELECT_KEY_CHECK).bind(KEY_CHECK_META_KEY).first();
  return (await evaluateKeyCheck(key, row)).result;
}

/** The first row of the results of one batched statement, or `undefined`. */
function firstRow(result: unknown): unknown {
  const rows: unknown = typeof result === "object" && result !== null && "results" in result ? result.results : [];
  return Array.isArray(rows) ? (rows[0] as unknown) : undefined;
}

function sealedOf(row: unknown): { readonly iv: string; readonly ciphertext: string } | undefined {
  if (typeof row !== "object" || row === null || !("iv" in row) || !("ciphertext" in row)) {
    return undefined;
  }
  const { iv, ciphertext } = row;
  return typeof iv === "string" && typeof ciphertext === "string" ? { iv, ciphertext } : undefined;
}

/** Reads and decrypts one credential in one D1 round trip. D1 errors are not caught. */
export async function readSecret(db: D1Database, key: CryptoKey, name: SecretName): Promise<SecretReadResult> {
  const [keyCheckResult, secretResult] = await db.batch([
    db.prepare(SELECT_KEY_CHECK).bind(KEY_CHECK_META_KEY),
    db.prepare(SELECT_SECRET).bind(name),
  ]);
  const secretRow = firstRow(secretResult);
  if (secretRow === undefined) {
    return { kind: "missing" };
  }
  const sealed = sealedOf(secretRow);
  if (sealed === undefined) {
    return { kind: "corrupt" };
  }
  const { result } = await evaluateKeyCheck(key, firstRow(keyCheckResult));
  if (result === "changed") {
    return { kind: "secret-changed" };
  }
  if (result !== "match") {
    return { kind: "corrupt" };
  }
  const value = await decrypt(key, sealed, `secrets/${name}`);
  return value === undefined ? { kind: "corrupt" } : { kind: "ok", value };
}

function changesOfLast(results: readonly D1Result[]): number | undefined {
  return results.at(-1)?.meta.changes;
}

/**
 * Encrypts and stores one credential, storing the key check value with the first one; writes only while the
 * checked key check value is still stored, with one retry. D1 errors are not caught.
 */
export async function writeSecret(
  db: D1Database,
  key: CryptoKey,
  name: SecretName,
  value: string,
): Promise<SecretWriteResult> {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const row = await db.prepare(SELECT_KEY_CHECK).bind(KEY_CHECK_META_KEY).first();
    const check = await evaluateKeyCheck(key, row);
    if (check.result === "changed") {
      return { kind: "secret-changed" };
    }
    if (check.result === "corrupt") {
      return { kind: "corrupt" };
    }
    const sealed = await encrypt(key, value, `secrets/${name}`);
    const statements: D1PreparedStatement[] = [];
    let expected: string;
    if (check.stored === undefined) {
      const keyCheck = await encrypt(key, KEY_CHECK_PLAINTEXT, KEY_CHECK_CONTEXT);
      expected = `${keyCheck.iv}.${keyCheck.ciphertext}`;
      statements.push(db.prepare(INSERT_KEY_CHECK).bind(KEY_CHECK_META_KEY, expected));
    } else {
      expected = check.stored;
    }
    statements.push(db.prepare(UPSERT_SECRET).bind(name, sealed.iv, sealed.ciphertext, KEY_CHECK_META_KEY, expected));
    const results = await db.batch(statements);
    if (changesOfLast(results) === 1) {
      return { kind: "ok" };
    }
  }
  return { kind: "corrupt" };
}

/**
 * Encrypts and stores all three credentials in one batch, storing the key check value with the first write; writes
 * only while the checked key check value is still stored, with one retry. D1 errors are not caught.
 */
export async function writeSecrets(
  _db: D1Database,
  _key: CryptoKey,
  _values: Readonly<Record<SecretName, string>>,
): Promise<SecretWriteResult> {
  throw new Error("Not implemented");
}
