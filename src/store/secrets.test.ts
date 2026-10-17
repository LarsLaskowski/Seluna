import { env } from "cloudflare:workers";
import { assert, beforeEach, describe, expect, it } from "vitest";
import { encrypt } from "../crypto";
import { checkKey, KEY_CHECK_META_KEY, KEY_CHECK_PLAINTEXT, readSecret, writeSecret, writeSecrets } from "./secrets";
import type { SecretName } from "./secrets";
import { applyMigrations } from "../../test/d1";
import { keyFor, withFirstCharacterChanged } from "../../test/keys";

const SECRET_A = "0123456789abcdef0123456789abcdef";
const SECRET_B = "fedcba9876543210fedcba9876543210";
const PEM =
  "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC\n-----END PRIVATE KEY-----\n";
const PEM_WITH_UMLAUT = "-----BEGIN PRIVATE KEY-----\nSchlüssel ä\n-----END PRIVATE KEY-----\n";
const KEY_CHECK_FORM = /^[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]+={0,2}$/;

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([env.DB.prepare("DELETE FROM secrets"), env.DB.prepare("DELETE FROM meta")]);
});

async function allRows(sql: string): Promise<Record<string, unknown>[]> {
  const result = await env.DB.prepare(sql).all();
  return result.results;
}

/** Every row of `secrets`, in key order, as stored. */
function secretRows(): Promise<Record<string, unknown>[]> {
  return allRows("SELECT key, iv, ciphertext FROM secrets ORDER BY key");
}

/** Every row of `meta`, in key order, as stored. */
function metaRows(): Promise<Record<string, unknown>[]> {
  return allRows("SELECT key, value FROM meta ORDER BY key");
}

/** The stored key check text, or `undefined` when no `key_check` row exists. */
async function storedKeyCheck(): Promise<unknown> {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = ?1").bind(KEY_CHECK_META_KEY).first();
  return row?.value;
}

async function seedKeyCheck(secret: string, plaintext: string): Promise<string> {
  const sealed = await encrypt(await keyFor(secret), plaintext, "meta/key_check");
  return `${sealed.iv}.${sealed.ciphertext}`;
}

async function putKeyCheck(text: string): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)").bind(KEY_CHECK_META_KEY, text).run();
}

async function seed(secret: string, name: SecretName, value: string): Promise<void> {
  const result = await writeSecret(env.DB, await keyFor(secret), name, value);
  expect(result, `seeding ${name}`).toEqual({ kind: "ok" });
}

function asText(value: unknown, column: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${column} is stored as text`);
  }
  return value;
}

async function rawSecret(name: SecretName): Promise<{ readonly iv: string; readonly ciphertext: string }> {
  const row = await env.DB.prepare("SELECT iv, ciphertext FROM secrets WHERE key = ?1").bind(name).first();
  assert.isNotNull(row, `the secrets row ${name} exists`);
  return { iv: asText(row.iv, "iv"), ciphertext: asText(row.ciphertext, "ciphertext") };
}

interface D1Calls {
  readonly prepared: string[];
  readonly batchSizes: number[];
}

/**
 * A D1 double over `env.DB`: forwards everything, records the calls and runs `step` (SQL on `env.DB`) before
 * forwarding a `batch`, on the first call only or on every call.
 */
function forwardingDb(
  step: (() => Promise<void>) | undefined,
  runs: "first" | "every",
): { readonly db: D1Database; readonly calls: D1Calls } {
  const calls: D1Calls = { prepared: [], batchSizes: [] };
  const db: D1Database = {
    prepare: (query) => {
      calls.prepared.push(query);
      return env.DB.prepare(query);
    },
    exec: (query) => env.DB.exec(query),
    withSession: (constraintOrBookmark) => env.DB.withSession(constraintOrBookmark),
    dump: () => Promise.reject(new Error("dump is deprecated and not forwarded")),
    batch: async <T = unknown>(statements: D1PreparedStatement[]) => {
      calls.batchSizes.push(statements.length);
      const interferes = runs === "every" || calls.batchSizes.length === 1;
      if (interferes && step !== undefined) {
        await step();
      }
      return env.DB.batch<T>(statements);
    },
  };
  return { db, calls };
}

function runSql(sql: string, ...values: unknown[]): () => Promise<void> {
  return async () => {
    await env.DB.prepare(sql)
      .bind(...values)
      .run();
  };
}

describe("writeSecret", () => {
  it("writeSecret stores neither the value nor its base64 in the row", async () => {
    const key = await keyFor(SECRET_A);

    await writeSecret(env.DB, key, "github_private_key", PEM);

    const row = await rawSecret("github_private_key");
    expect(row.iv.length, "iv length").toBe(16);
    expect(row.iv.includes(PEM), "iv contains the value").toBe(false);
    expect(row.iv.includes(btoa(PEM)), "iv contains base64 of the value").toBe(false);
    expect(row.ciphertext.includes(PEM), "ciphertext contains the value").toBe(false);
    expect(row.ciphertext.includes(btoa(PEM)), "ciphertext contains base64 of the value").toBe(false);
    expect(atob(row.ciphertext).includes(PEM), "decoded ciphertext bytes contain the value").toBe(false);
  });

  it("writeSecret stores a new IV and ciphertext when the same value is written again", async () => {
    await seed(SECRET_A, "github_app_id", "12345");
    const before = await rawSecret("github_app_id");

    await writeSecret(env.DB, await keyFor(SECRET_A), "github_app_id", "12345");

    const after = await rawSecret("github_app_id");
    expect(after.iv, "iv").not.toBe(before.iv);
    expect(after.ciphertext, "ciphertext").not.toBe(before.ciphertext);
  });

  it("writeSecret replaces a stored value", async () => {
    const key = await keyFor(SECRET_A);
    await seed(SECRET_A, "github_app_id", "old");

    const result = await writeSecret(env.DB, key, "github_app_id", "new");

    expect(result, "write result").toEqual({ kind: "ok" });
    expect(await readSecret(env.DB, key, "github_app_id"), "read result").toEqual({ kind: "ok", value: "new" });
    expect(await secretRows(), "number of secrets rows").toHaveLength(1);
  });

  it("writeSecret reports secret-changed under another key and leaves the stored row unchanged", async () => {
    await seed(SECRET_A, "github_app_id", "12345");
    const secretsBefore = await secretRows();
    const metaBefore = await metaRows();

    const result = await writeSecret(env.DB, await keyFor(SECRET_B), "github_app_id", "67890");

    expect(result, "write result").toEqual({ kind: "secret-changed" });
    expect(await secretRows(), "secrets rows").toEqual(secretsBefore);
    expect(await metaRows(), "meta rows").toEqual(metaBefore);
  });

  it("writeSecret stores the key check value with the first credential", async () => {
    const key = await keyFor(SECRET_A);

    await writeSecret(env.DB, key, "github_app_id", "12345");

    expect(await storedKeyCheck(), "key check row").toMatch(KEY_CHECK_FORM);
    expect(await checkKey(env.DB, key), "checkKey under the same key").toBe("match");
  });

  it("writeSecret reports corrupt when the key check value is malformed and writes nothing", async () => {
    await putKeyCheck("not-a-key-check");

    const result = await writeSecret(env.DB, await keyFor(SECRET_A), "github_app_id", "12345");

    expect(result, "write result").toEqual({ kind: "corrupt" });
    expect(await secretRows(), "secrets rows").toEqual([]);
    expect(await metaRows(), "meta rows").toEqual([{ key: KEY_CHECK_META_KEY, value: "not-a-key-check" }]);
  });

  it("writeSecret reports corrupt when the key check value has one dot but malformed parts and writes nothing", async () => {
    await putKeyCheck("abc.def");

    const result = await writeSecret(env.DB, await keyFor(SECRET_A), "github_app_id", "12345");

    expect(result, "write result").toEqual({ kind: "corrupt" });
    expect(await secretRows(), "secrets rows").toEqual([]);
    expect(await metaRows(), "meta rows").toEqual([{ key: KEY_CHECK_META_KEY, value: "abc.def" }]);
  });

  it("writeSecret reports corrupt and writes nothing when secrets holds a credential but the key check value is absent", async () => {
    await seed(SECRET_A, "github_app_id", "12345");
    await env.DB.prepare("DELETE FROM meta WHERE key = ?1").bind(KEY_CHECK_META_KEY).run();
    const secretsBefore = await secretRows();

    const result = await writeSecret(env.DB, await keyFor(SECRET_A), "github_webhook_secret", "hook");

    expect(result, "write result").toEqual({ kind: "corrupt" });
    expect(await secretRows(), "secrets rows").toEqual(secretsBefore);
    expect(await metaRows(), "meta rows").toEqual([]);
  });
});

describe("readSecret", () => {
  it("readSecret returns the value writeSecret stored", async () => {
    const key = await keyFor(SECRET_A);
    await seed(SECRET_A, "github_private_key", PEM_WITH_UMLAUT);

    const result = await readSecret(env.DB, key, "github_private_key");

    expect(result, "read result").toEqual({ kind: "ok", value: PEM_WITH_UMLAUT });
  });

  it("readSecret reports missing for a name that was never written", async () => {
    const result = await readSecret(env.DB, await keyFor(SECRET_A), "github_webhook_secret");

    expect(result, "read result").toEqual({ kind: "missing" });
  });

  it("readSecret reports secret-changed under a key derived from another SELUNA_SECRET", async () => {
    await seed(SECRET_A, "github_app_id", "12345");

    const result = await readSecret(env.DB, await keyFor(SECRET_B), "github_app_id");

    expect(result, "read result").toEqual({ kind: "secret-changed" });
  });

  it("readSecret reports corrupt when the key check value is absent", async () => {
    await seed(SECRET_A, "github_app_id", "12345");
    await env.DB.prepare("DELETE FROM meta WHERE key = ?1").bind(KEY_CHECK_META_KEY).run();

    const result = await readSecret(env.DB, await keyFor(SECRET_A), "github_app_id");

    expect(result, "read result").toEqual({ kind: "corrupt" });
  });

  it("readSecret reports corrupt when the key check value is malformed", async () => {
    await seed(SECRET_A, "github_app_id", "12345");
    await putKeyCheck("not-a-key-check");

    const result = await readSecret(env.DB, await keyFor(SECRET_A), "github_app_id");

    expect(result, "read result").toEqual({ kind: "corrupt" });
  });

  it.each([
    ["abc.def", "abc.def"],
    [".", "."],
    ["not base64!.x", "not base64!.x"],
    ["an empty ciphertext", "AAAAAAAAAAAAAAAA."],
    ["a 15-character IV", `${"A".repeat(15)}.${"A".repeat(24)}`],
    ["a 20-character ciphertext", `${"A".repeat(16)}.${"A".repeat(20)}`],
    ["an unpadded 22-character ciphertext", `${"A".repeat(16)}.${"A".repeat(22)}`],
    ["an unpadded 25-character ciphertext", `${"A".repeat(16)}.${"A".repeat(25)}`],
  ])(
    "readSecret reports corrupt when the key check value has one dot but malformed parts (%s)",
    async (_label, text) => {
      await seed(SECRET_A, "github_app_id", "12345");
      await putKeyCheck(text);

      const result = await readSecret(env.DB, await keyFor(SECRET_A), "github_app_id");

      expect(result, "read result").toEqual({ kind: "corrupt" });
    },
  );

  it("readSecret reports secret-changed for a well-formed key check value that does not decrypt", async () => {
    await seed(SECRET_A, "github_app_id", "12345");
    await putKeyCheck(`${"A".repeat(16)}.${"A".repeat(24)}`);

    const result = await readSecret(env.DB, await keyFor(SECRET_A), "github_app_id");

    expect(result, "read result").toEqual({ kind: "secret-changed" });
  });

  it("readSecret reports corrupt for a ciphertext copied from another secret's row", async () => {
    await seed(SECRET_A, "github_webhook_secret", "hook");
    await seed(SECRET_A, "github_app_id", "12345");
    await env.DB.prepare(
      "UPDATE secrets SET iv = (SELECT iv FROM secrets WHERE key = ?1), ciphertext = (SELECT ciphertext FROM secrets WHERE key = ?1) WHERE key = ?2",
    )
      .bind("github_webhook_secret", "github_app_id")
      .run();

    const result = await readSecret(env.DB, await keyFor(SECRET_A), "github_app_id");

    expect(result, "read result").toEqual({ kind: "corrupt" });
  });

  it("readSecret reports corrupt when the stored ciphertext is a BLOB instead of text", async () => {
    await seed(SECRET_A, "github_app_id", "12345");
    await env.DB.prepare("UPDATE secrets SET ciphertext = X'00' WHERE key = ?1").bind("github_app_id").run();

    const result = await readSecret(env.DB, await keyFor(SECRET_A), "github_app_id");

    expect(result, "read result").toEqual({ kind: "corrupt" });
  });

  it("readSecret reports corrupt for an altered ciphertext", async () => {
    await seed(SECRET_A, "github_app_id", "12345");
    const stored = await rawSecret("github_app_id");
    await runSql(
      "UPDATE secrets SET ciphertext = ?1 WHERE key = ?2",
      withFirstCharacterChanged(stored.ciphertext),
      "github_app_id",
    )();

    const result = await readSecret(env.DB, await keyFor(SECRET_A), "github_app_id");

    expect(result, "read result").toEqual({ kind: "corrupt" });
  });

  it("readSecret reads the key check value and the credential in one batch", async () => {
    await seed(SECRET_A, "github_app_id", "12345");
    const { db, calls } = forwardingDb(undefined, "first");

    const result = await readSecret(db, await keyFor(SECRET_A), "github_app_id");

    expect(result, "read result").toEqual({ kind: "ok", value: "12345" });
    expect(calls.batchSizes, "batch calls and their statement counts").toEqual([2]);
    expect(calls.prepared, "statements prepared, all of them in the batch").toHaveLength(2);
  });
});

describe("checkKey", () => {
  it("checkKey reports unset on an empty database", async () => {
    const result = await checkKey(env.DB, await keyFor(SECRET_A));

    expect(result, "key check result").toBe("unset");
  });

  it("checkKey reports changed under a key derived from another SELUNA_SECRET", async () => {
    await seed(SECRET_A, "github_app_id", "12345");

    const result = await checkKey(env.DB, await keyFor(SECRET_B));

    expect(result, "key check result").toBe("changed");
  });

  it("checkKey reports corrupt when the key check value decrypts to another text", async () => {
    await putKeyCheck(await seedKeyCheck(SECRET_A, "other"));

    const result = await checkKey(env.DB, await keyFor(SECRET_A));

    expect(result, "key check result").toBe("corrupt");
  });
});

describe("writeSecret racing a reset or another write", () => {
  it("writeSecret stores the credential with a new key check value when a reset emptied the database between check and write", async () => {
    await seed(SECRET_A, "github_app_id", "old");
    const reset = async (): Promise<void> => {
      await env.DB.batch([env.DB.prepare("DELETE FROM secrets"), env.DB.prepare("DELETE FROM meta")]);
    };
    const { db } = forwardingDb(reset, "first");
    const key = await keyFor(SECRET_A);

    const result = await writeSecret(db, key, "github_app_id", "new");

    expect(result, "write result").toEqual({ kind: "ok" });
    expect(await readSecret(env.DB, key, "github_app_id"), "read result").toEqual({ kind: "ok", value: "new" });
    expect(await checkKey(env.DB, key), "key check result").toBe("match");
    expect(
      (await secretRows()).map((row) => row.key),
      "secrets keys",
    ).toEqual(["github_app_id"]);
    expect(
      (await metaRows()).map((row) => row.key),
      "meta keys",
    ).toEqual([KEY_CHECK_META_KEY]);
  });

  it("writeSecret stores the credential when another first write under the same key stored the key check value between check and write", async () => {
    const sealedUnderA = await seedKeyCheck(SECRET_A, KEY_CHECK_PLAINTEXT);
    const { db } = forwardingDb(
      runSql("INSERT INTO meta (key, value) VALUES (?1, ?2)", KEY_CHECK_META_KEY, sealedUnderA),
      "first",
    );
    const key = await keyFor(SECRET_A);

    const result = await writeSecret(db, key, "github_app_id", "12345");

    expect(result, "write result").toEqual({ kind: "ok" });
    expect(await readSecret(env.DB, key, "github_app_id"), "read result").toEqual({ kind: "ok", value: "12345" });
    expect(await storedKeyCheck(), "key check row").toBe(sealedUnderA);
  });

  it("writeSecret reports secret-changed and writes nothing when a key check value under another key was stored between check and write", async () => {
    const sealedUnderB = await seedKeyCheck(SECRET_B, KEY_CHECK_PLAINTEXT);
    const { db } = forwardingDb(
      runSql("INSERT INTO meta (key, value) VALUES (?1, ?2)", KEY_CHECK_META_KEY, sealedUnderB),
      "first",
    );

    const result = await writeSecret(db, await keyFor(SECRET_A), "github_app_id", "12345");

    expect(result, "write result").toEqual({ kind: "secret-changed" });
    expect(await secretRows(), "secrets rows").toEqual([]);
    expect(await metaRows(), "meta rows").toEqual([{ key: KEY_CHECK_META_KEY, value: sealedUnderB }]);
  });

  it("writeSecret reports corrupt and leaves the stored row unchanged when the key check value changes before every write", async () => {
    await seed(SECRET_A, "github_app_id", "old");
    const secretsBefore = await secretRows();
    const key = await keyFor(SECRET_A);
    const replaceKeyCheck = async (): Promise<void> => {
      const sealed = await encrypt(key, KEY_CHECK_PLAINTEXT, "meta/key_check");
      await putKeyCheck(`${sealed.iv}.${sealed.ciphertext}`);
    };
    const { db, calls } = forwardingDb(replaceKeyCheck, "every");

    const result = await writeSecret(db, key, "github_app_id", "new");

    expect(result, "write result").toEqual({ kind: "corrupt" });
    expect(calls.batchSizes, "batch calls: two attempts").toHaveLength(2);
    expect(await secretRows(), "secrets rows").toEqual(secretsBefore);
  });
});

const CREDENTIALS = { github_app_id: "12345", github_private_key: PEM, github_webhook_secret: "whsec-0123456789" };
const OLD_CREDENTIALS = { github_app_id: "old", github_private_key: "old-key", github_webhook_secret: "old-hook" };
const NAMES = ["github_app_id", "github_private_key", "github_webhook_secret"] as const;

/** `changes` as the results of a batch: one D1 result per entry. */
function resultsOf<T>(changes: readonly number[]): D1Result<T>[] {
  return changes.map((count) => ({
    success: true,
    results: [],
    meta: {
      duration: 0,
      size_after: 0,
      rows_read: 0,
      rows_written: count,
      last_row_id: 0,
      changed_db: count > 0,
      changes: count,
    },
  }));
}

/** A D1 double over `env.DB` that forwards `prepare` and answers every `batch` with the canned `changes` without running it. */
function cannedBatchDb(changes: readonly number[]): { readonly db: D1Database; readonly batchSizes: number[] } {
  const batchSizes: number[] = [];
  const db: D1Database = {
    prepare: (query) => env.DB.prepare(query),
    exec: (query) => env.DB.exec(query),
    withSession: (constraintOrBookmark) => env.DB.withSession(constraintOrBookmark),
    dump: () => Promise.reject(new Error("dump is deprecated and not forwarded")),
    batch: <T = unknown>(statements: D1PreparedStatement[]) => {
      batchSizes.push(statements.length);
      return Promise.resolve(resultsOf<T>(changes));
    },
  };
  return { db, batchSizes };
}

async function seedAll(secret: string, values: Readonly<Record<(typeof NAMES)[number], string>>): Promise<void> {
  for (const name of NAMES) {
    await seed(secret, name, values[name]);
  }
}

describe("writeSecrets", () => {
  it("writeSecrets stores the three credentials and the key check value on the first write", async () => {
    const key = await keyFor(SECRET_A);
    const { db, calls } = forwardingDb(undefined, "every");

    const result = await writeSecrets(db, key, CREDENTIALS);

    expect(result, "write result").toEqual({ kind: "ok" });
    expect(calls.batchSizes, "one batch: the key check insert and the three upserts").toEqual([4]);
    expect(await readSecret(env.DB, key, "github_app_id"), "App ID").toEqual({ kind: "ok", value: "12345" });
    expect(await readSecret(env.DB, key, "github_private_key"), "private key").toEqual({ kind: "ok", value: PEM });
    expect(await readSecret(env.DB, key, "github_webhook_secret"), "webhook secret").toEqual({
      kind: "ok",
      value: "whsec-0123456789",
    });
    expect(String(await storedKeyCheck()), "key check value").toMatch(KEY_CHECK_FORM);
    expect(await checkKey(env.DB, key), "key check result").toBe("match");
    expect(
      (await secretRows()).map((row) => row.key),
      "secrets keys",
    ).toEqual(["github_app_id", "github_private_key", "github_webhook_secret"]);
  });

  it("writeSecrets replaces earlier values of all three", async () => {
    await seedAll(SECRET_A, OLD_CREDENTIALS);
    const key = await keyFor(SECRET_A);
    const keyCheckBefore = await storedKeyCheck();
    const { db, calls } = forwardingDb(undefined, "every");

    const result = await writeSecrets(db, key, CREDENTIALS);

    expect(result, "write result").toEqual({ kind: "ok" });
    expect(calls.batchSizes, "one batch of the three upserts").toEqual([3]);
    expect(await readSecret(env.DB, key, "github_app_id"), "App ID").toEqual({ kind: "ok", value: "12345" });
    expect(await readSecret(env.DB, key, "github_private_key"), "private key").toEqual({ kind: "ok", value: PEM });
    expect(await readSecret(env.DB, key, "github_webhook_secret"), "webhook secret").toEqual({
      kind: "ok",
      value: "whsec-0123456789",
    });
    expect(await storedKeyCheck(), "key check value").toBe(keyCheckBefore);
    expect(await secretRows(), "number of secrets rows").toHaveLength(3);
  });

  it("writeSecrets writes none of the three under a changed SELUNA_SECRET", async () => {
    await seedAll(SECRET_A, OLD_CREDENTIALS);
    const secretsBefore = await secretRows();
    const metaBefore = await metaRows();

    const result = await writeSecrets(env.DB, await keyFor(SECRET_B), CREDENTIALS);

    expect(result, "write result").toEqual({ kind: "secret-changed" });
    expect(await secretRows(), "secrets rows").toEqual(secretsBefore);
    expect(await metaRows(), "meta rows").toEqual(metaBefore);
  });

  it.each([
    {
      name: "malformed",
      prepare: async () => {
        await putKeyCheck("not-a-key-check");
      },
    },
    {
      name: "absent while a credential is stored",
      prepare: async () => {
        await seed(SECRET_A, "github_app_id", "old");
        await env.DB.prepare("DELETE FROM meta").run();
      },
    },
  ])("writeSecrets writes none of the three when the key check value is corrupt: $name", async ({ prepare }) => {
    await prepare();
    const secretsBefore = await secretRows();

    const result = await writeSecrets(env.DB, await keyFor(SECRET_A), CREDENTIALS);

    expect(result, "write result").toEqual({ kind: "corrupt" });
    expect(await secretRows(), "secrets rows").toEqual(secretsBefore);
  });

  it.each([
    { name: "the third upsert changed no row", changes: [1, 1, 0] },
    { name: "the first upsert changed no row while the last changed one", changes: [0, 1, 1] },
    { name: "the second upsert changed no row", changes: [1, 0, 1] },
  ])("writeSecrets reports ok only when each of the three upserts changed one row: $name", async ({ changes }) => {
    await seed(SECRET_A, "github_app_id", "old");
    const { db, batchSizes } = cannedBatchDb(changes);

    const result = await writeSecrets(db, await keyFor(SECRET_A), CREDENTIALS);

    expect(result, "write result").toEqual({ kind: "corrupt" });
    expect(batchSizes, "two attempts of three statements").toEqual([3, 3]);
  });

  it("writeSecrets reports ok when each upsert changed one row", async () => {
    await seed(SECRET_A, "github_app_id", "old");
    const { db, batchSizes } = cannedBatchDb([1, 1, 1]);

    const result = await writeSecrets(db, await keyFor(SECRET_A), CREDENTIALS);

    expect(result, "write result").toEqual({ kind: "ok" });
    expect(batchSizes, "one attempt").toEqual([3]);
  });

  it("writeSecrets leaves the key check insert out of the change count", async () => {
    const { db, batchSizes } = cannedBatchDb([0, 1, 1, 1]);

    const result = await writeSecrets(db, await keyFor(SECRET_A), CREDENTIALS);

    expect(result, "write result").toEqual({ kind: "ok" });
    expect(batchSizes, "one attempt of the key check insert and three upserts").toEqual([4]);
  });
});
