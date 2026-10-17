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

const SELECT_SECRETS_PRESENT = "SELECT EXISTS (SELECT 1 FROM secrets) AS present";

/** Compares the stored key check value with `key` (the key from `keyFromEnv`); an absent key check beside stored credentials is `corrupt`. */
export async function checkKey(db: D1Database, key: CryptoKey): Promise<KeyCheckResult> {
  const [keyCheckResult, presentResult] = await db.batch([
    db.prepare(SELECT_KEY_CHECK).bind(KEY_CHECK_META_KEY),
    db.prepare(SELECT_SECRETS_PRESENT),
  ]);
  const { result } = await evaluateKeyCheck(key, firstRow(keyCheckResult));
  if (result !== "unset") {
    return result;
  }
  const present: unknown = firstRow(presentResult);
  const flag: unknown = typeof present === "object" && present !== null && "present" in present ? present.present : 0;
  return flag === 1 ? "corrupt" : "unset";
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

type SecretEntry = readonly [name: SecretName, value: string];

/** Whether the last `count` results, the upserts of a batch, each changed exactly one row. */
function eachUpsertChangedOne(results: readonly D1Result[], count: number): boolean {
  const upserts = results.slice(-count);
  return upserts.length === count && upserts.every((result) => result.meta.changes === 1);
}

/**
 * Encrypts `entries` and stores them in one batch, with the key check value when none is stored yet; writes only
 * while the checked key check value is still stored, with one retry. The batch is `ok` when each upsert changed one
 * row; the key check insert is not counted.
 */
async function writeEntries(
  db: D1Database,
  key: CryptoKey,
  entries: readonly SecretEntry[],
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
    const statements: D1PreparedStatement[] = [];
    let expected: string;
    if (check.stored === undefined) {
      const keyCheck = await encrypt(key, KEY_CHECK_PLAINTEXT, KEY_CHECK_CONTEXT);
      expected = `${keyCheck.iv}.${keyCheck.ciphertext}`;
      statements.push(db.prepare(INSERT_KEY_CHECK).bind(KEY_CHECK_META_KEY, expected));
    } else {
      expected = check.stored;
    }
    const sealedValues = await Promise.all(entries.map(([name, value]) => encrypt(key, value, `secrets/${name}`)));
    entries.forEach(([name], index) => {
      const sealed = sealedValues[index];
      if (sealed !== undefined) {
        statements.push(
          db.prepare(UPSERT_SECRET).bind(name, sealed.iv, sealed.ciphertext, KEY_CHECK_META_KEY, expected),
        );
      }
    });
    const results = await db.batch(statements);
    if (eachUpsertChangedOne(results, entries.length)) {
      return { kind: "ok" };
    }
  }
  return { kind: "corrupt" };
}

/**
 * Encrypts and stores one credential, storing the key check value with the first one; writes only while the
 * checked key check value is still stored, with one retry. D1 errors are not caught.
 */
export function writeSecret(
  db: D1Database,
  key: CryptoKey,
  name: SecretName,
  value: string,
): Promise<SecretWriteResult> {
  return writeEntries(db, key, [[name, value]]);
}

/**
 * Encrypts and stores all three credentials in one batch, storing the key check value with the first write; writes
 * only while the checked key check value is still stored, with one retry. D1 errors are not caught.
 */
export function writeSecrets(
  db: D1Database,
  key: CryptoKey,
  values: Readonly<Record<SecretName, string>>,
): Promise<SecretWriteResult> {
  return writeEntries(db, key, [
    ["github_app_id", values.github_app_id],
    ["github_private_key", values.github_private_key],
    ["github_webhook_secret", values.github_webhook_secret],
  ]);
}

const SELECT_KEY_CHECK_PINNED = "SELECT value, quote(value) AS pinned FROM meta WHERE key = ?1";
const SELECT_ALL_SECRETS = "SELECT key, iv, ciphertext FROM secrets";
/** The SQLite expression of the credentials' fingerprint: key and IV of every `secrets` row, in key order. */
const FINGERPRINT =
  "(SELECT group_concat(quote(key) || ':' || quote(iv), ',') FROM (SELECT key, iv FROM secrets ORDER BY key))";
const SELECT_FINGERPRINT = `SELECT ${FINGERPRINT} AS fingerprint`;
const RESET_GUARD = `(SELECT quote(value) FROM meta WHERE key = 'key_check') IS ?1 AND ${FINGERPRINT} IS ?2`;
const DELETE_TOKEN_CACHE = `DELETE FROM token_cache WHERE ${RESET_GUARD}`;
const DELETE_SECRETS = `DELETE FROM secrets WHERE ${RESET_GUARD}`;
const DELETE_KEY_CHECK =
  "DELETE FROM meta WHERE key = 'key_check' AND (SELECT quote(value) FROM meta WHERE key = 'key_check') IS ?1 " +
  "AND NOT EXISTS (SELECT 1 FROM secrets)";

interface CredentialState {
  readonly needsReset: boolean;
  /** `quote(value)` of the key check row, `null` when the row is absent. */
  readonly pinned: string | null;
  /** The fingerprint of the `secrets` rows, `null` for an empty table. */
  readonly fingerprint: string | null;
}

function textOf(row: unknown, name: string): string | null {
  if (typeof row !== "object" || row === null || !(name in row)) {
    return null;
  }
  const value: unknown = Reflect.get(row, name);
  return typeof value === "string" ? value : null;
}

function allRows(result: unknown): readonly unknown[] {
  const rows: unknown = typeof result === "object" && result !== null && "results" in result ? result.results : [];
  return Array.isArray(rows) ? rows : [];
}

/** Whether a stored credential row decrypts under `key`. */
async function decryptsUnder(key: CryptoKey, row: unknown): Promise<boolean> {
  const name = textOf(row, "key");
  const sealed = sealedOf(row);
  return name !== null && sealed !== undefined && (await decrypt(key, sealed, `secrets/${name}`)) !== undefined;
}

/** Reads the key check, the credentials and the pins of the reset guard in one batch. */
async function readCredentialState(db: D1Database, key: CryptoKey): Promise<CredentialState> {
  const [keyCheckResult, secretsResult, fingerprintResult] = await db.batch([
    db.prepare(SELECT_KEY_CHECK_PINNED).bind(KEY_CHECK_META_KEY),
    db.prepare(SELECT_ALL_SECRETS),
    db.prepare(SELECT_FINGERPRINT),
  ]);
  const keyCheckRow = firstRow(keyCheckResult);
  const rows = allRows(secretsResult);
  const { result } = await evaluateKeyCheck(key, keyCheckRow);
  let reset: boolean;
  switch (result) {
    case "changed":
    case "corrupt":
      reset = true;
      break;
    case "unset":
      reset = rows.length > 0;
      break;
    case "match":
      reset = !(await Promise.all(rows.map((row) => decryptsUnder(key, row)))).every(Boolean);
      break;
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
  return {
    needsReset: reset,
    pinned: textOf(keyCheckRow, "pinned"),
    fingerprint: textOf(firstRow(fingerprintResult), "fingerprint"),
  };
}

/** Whether the saved credentials cannot be read with `key` (changed or corrupt key check, or a credential that does not decrypt). D1 errors are not caught. */
export async function needsReset(db: D1Database, key: CryptoKey): Promise<boolean> {
  return (await readCredentialState(db, key)).needsReset;
}

export type ResetResult = "reset" | "not-needed";

/**
 * Deletes the credentials, the installation tokens and the key check value while the credentials cannot be read
 * with `key` and are unchanged since the check. D1 errors are not caught.
 */
export async function resetCredentials(db: D1Database, key: CryptoKey): Promise<ResetResult> {
  const state = await readCredentialState(db, key);
  if (!state.needsReset) {
    return "not-needed";
  }
  await db.batch([
    db.prepare(DELETE_TOKEN_CACHE).bind(state.pinned, state.fingerprint),
    db.prepare(DELETE_SECRETS).bind(state.pinned, state.fingerprint),
    db.prepare(DELETE_KEY_CHECK).bind(state.pinned),
  ]);
  return "reset";
}
