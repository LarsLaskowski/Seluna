import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { encrypt } from "../crypto";
import { deleteCachedToken, readCachedToken, writeCachedToken } from "./token-cache";
import { applyMigrations, migrationTestDb, writeFailingDb } from "../../test/d1";
import { FIXTURE_TOKEN } from "../../test/github";
import { keyFor } from "../../test/keys";
import { seedCachedToken, tokenContext, tokenOfRow, tokenRowOf, tokenRows } from "../../test/token-cache";

const SECRET = "throwaway-setup-secret-0123456789abcdef";
const OTHER_SECRET = "another-throwaway-secret-fedcba9876543210";
const INSTALLATION = 1_000_003;
const OTHER_INSTALLATION = 2_000_004;
const EXPIRES_AT = 1_792_414_800_000;
const TOKEN = FIXTURE_TOKEN;

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.prepare("DELETE FROM token_cache").run();
});

async function rowOrFail(installationId = INSTALLATION): ReturnType<typeof tokenRowOf> {
  const row = await tokenRowOf(env.DB, installationId);
  expect(row, `row of installation ${String(installationId)}`).toBeDefined();
  return row;
}

describe("writeCachedToken", () => {
  it("writeCachedToken stores a row that decrypts with exactly token_cache/<id>/<expires_at>", async () => {
    const key = await keyFor(SECRET);

    const iv = await writeCachedToken(env.DB, key, INSTALLATION, TOKEN, EXPIRES_AT);

    const row = await rowOrFail();
    expect(row?.iv, "iv of the row is the returned IV").toBe(iv);
    expect(row?.expiresAt, "expires_at").toBe(EXPIRES_AT);
    expect(tokenContext(INSTALLATION, EXPIRES_AT), "additional data").toBe("token_cache/1000003/1792414800000");
    expect(row === undefined ? undefined : await tokenOfRow(key, row), "decrypted token").toBe(TOKEN);
  });

  it.each([
    { case: "another installation id", id: OTHER_INSTALLATION, expiresAt: EXPIRES_AT },
    { case: "another expiry", id: INSTALLATION, expiresAt: EXPIRES_AT + 1 },
  ])("writeCachedToken's row does not decrypt with $case in the additional data", async ({ id, expiresAt }) => {
    const key = await keyFor(SECRET);
    await writeCachedToken(env.DB, key, INSTALLATION, TOKEN, EXPIRES_AT);
    const row = await rowOrFail();

    const decrypted = row === undefined ? undefined : await tokenOfRow(key, { ...row, installationId: id, expiresAt });

    expect(decrypted, "decrypted token").toBeUndefined();
  });

  it("writeCachedToken keeps the plaintext token out of every column of the row", async () => {
    const key = await keyFor(SECRET);

    await writeCachedToken(env.DB, key, INSTALLATION, TOKEN, EXPIRES_AT);

    const raw = await env.DB.prepare("SELECT * FROM token_cache").first();
    expect(JSON.stringify(raw), "the row as stored").not.toContain(TOKEN);
    expect(JSON.stringify(raw), "the row as stored").not.toContain(btoa(TOKEN));
  });

  it("writeCachedToken draws a 12-byte IV, stored as 16 base64 characters", async () => {
    const key = await keyFor(SECRET);

    const iv = await writeCachedToken(env.DB, key, INSTALLATION, TOKEN, EXPIRES_AT);

    expect(iv, "iv").toMatch(/^[A-Za-z0-9+/]{16}$/);
  });

  it("writeCachedToken replaces the row of the installation with a new IV", async () => {
    const key = await keyFor(SECRET);
    const first = await writeCachedToken(env.DB, key, INSTALLATION, TOKEN, EXPIRES_AT);

    const second = await writeCachedToken(env.DB, key, INSTALLATION, "ghs_second", EXPIRES_AT + 5000);

    const rows = await tokenRows(env.DB);
    expect(rows.length, "number of rows").toBe(1);
    expect(second, "new IV").not.toBe(first);
    expect(rows[0]?.iv, "iv of the row").toBe(second);
    expect(rows[0]?.expiresAt, "expires_at of the row").toBe(EXPIRES_AT + 5000);
    expect(rows[0] === undefined ? undefined : await tokenOfRow(key, rows[0]), "token of the row").toBe("ghs_second");
  });

  it("writeCachedToken leaves the row of another installation unchanged", async () => {
    const key = await keyFor(SECRET);
    await writeCachedToken(env.DB, key, OTHER_INSTALLATION, "ghs_other", EXPIRES_AT);
    const before = await rowOrFail(OTHER_INSTALLATION);

    await writeCachedToken(env.DB, key, INSTALLATION, TOKEN, EXPIRES_AT);

    expect(await tokenRowOf(env.DB, OTHER_INSTALLATION), "row of the other installation").toEqual(before);
    expect((await tokenRows(env.DB)).length, "number of rows").toBe(2);
  });

  it("writeCachedToken lets a D1 error reach the caller", async () => {
    const pending = writeCachedToken(migrationTestDb(), await keyFor(SECRET), INSTALLATION, TOKEN, EXPIRES_AT);

    await expect(pending, "result").rejects.toThrow(/no such table/i);
  });

  it("writeCachedToken lets a failing write reach the caller and stores nothing", async () => {
    const pending = writeCachedToken(writeFailingDb(env.DB), await keyFor(SECRET), INSTALLATION, TOKEN, EXPIRES_AT);

    await expect(pending, "result").rejects.toThrow("The database may only be read");
    expect(await tokenRows(env.DB), "rows").toEqual([]);
  });
});

describe("readCachedToken", () => {
  it("readCachedToken returns the token, its expiry and the IV of the row", async () => {
    const key = await keyFor(SECRET);
    const iv = await seedCachedToken(env.DB, key, INSTALLATION, TOKEN, EXPIRES_AT);

    const cached = await readCachedToken(env.DB, key, INSTALLATION);

    expect(cached, "cached token").toEqual({ token: TOKEN, expiresAt: EXPIRES_AT, iv });
  });

  it("readCachedToken reads what writeCachedToken wrote", async () => {
    const key = await keyFor(SECRET);
    const iv = await writeCachedToken(env.DB, key, INSTALLATION, TOKEN, EXPIRES_AT);

    const cached = await readCachedToken(env.DB, key, INSTALLATION);

    expect(cached, "cached token").toEqual({ token: TOKEN, expiresAt: EXPIRES_AT, iv });
  });

  it("readCachedToken returns undefined without a row", async () => {
    const cached = await readCachedToken(env.DB, await keyFor(SECRET), INSTALLATION);

    expect(cached, "cached token").toBeUndefined();
  });

  it("readCachedToken reads the row of its own installation only", async () => {
    const key = await keyFor(SECRET);
    await seedCachedToken(env.DB, key, OTHER_INSTALLATION, "ghs_other", EXPIRES_AT);

    const cached = await readCachedToken(env.DB, key, INSTALLATION);

    expect(cached, "cached token").toBeUndefined();
  });

  it.each<{ case: string; prepare: () => Promise<void>; secret?: string }>([
    {
      case: "a changed expires_at",
      prepare: async () => {
        await env.DB.prepare("UPDATE token_cache SET expires_at = expires_at + 1").run();
      },
    },
    {
      case: "an altered ciphertext",
      prepare: async () => {
        await env.DB.prepare(
          "UPDATE token_cache SET ciphertext = (CASE WHEN substr(ciphertext, 1, 1) = 'A' THEN 'B' ELSE 'A' END) || substr(ciphertext, 2)",
        ).run();
      },
    },
    { case: "another SELUNA_SECRET", prepare: () => Promise.resolve(), secret: OTHER_SECRET },
    {
      case: "an IV that is no base64",
      prepare: async () => {
        await env.DB.prepare("UPDATE token_cache SET iv = '!!!!!!!!!!!!!!!!'").run();
      },
    },
    {
      case: "an IV of another row",
      prepare: async () => {
        await env.DB.prepare("UPDATE token_cache SET iv = 'AAAAAAAAAAAAAAAA'").run();
      },
    },
    {
      case: "a ciphertext that is no base64",
      prepare: async () => {
        await env.DB.prepare("UPDATE token_cache SET ciphertext = '***'").run();
      },
    },
    {
      case: "an expires_at that is a fraction",
      prepare: async () => {
        await env.DB.prepare("UPDATE token_cache SET expires_at = 1792414800000.5").run();
      },
    },
  ])("readCachedToken treats $case as no cached token", async ({ prepare, secret }) => {
    await seedCachedToken(env.DB, await keyFor(SECRET), INSTALLATION, TOKEN, EXPIRES_AT);
    await prepare();

    const cached = await readCachedToken(env.DB, await keyFor(secret ?? SECRET), INSTALLATION);

    expect(cached, "cached token").toBeUndefined();
  });

  it("readCachedToken treats a ciphertext copied from another installation's row as no cached token", async () => {
    const key = await keyFor(SECRET);
    await seedCachedToken(env.DB, key, OTHER_INSTALLATION, "ghs_other", EXPIRES_AT);
    const other = await rowOrFail(OTHER_INSTALLATION);
    await env.DB.prepare(
      "INSERT INTO token_cache (installation_id, iv, ciphertext, expires_at) VALUES (?1, ?2, ?3, ?4)",
    )
      .bind(INSTALLATION, other?.iv, other?.ciphertext, EXPIRES_AT)
      .run();

    const cached = await readCachedToken(env.DB, key, INSTALLATION);

    expect(cached, "cached token").toBeUndefined();
  });

  it.each([
    { case: "an empty token", token: "" },
    { case: "a token with a hyphen", token: "ghs-abc" },
    { case: "a token with a line break", token: "ghs_abc\r\nX-Injected: yes" },
    { case: "a token with a space", token: "ghs abc" },
    { case: "a token of 256 characters", token: "a".repeat(256) },
    { case: "a token with a non-ASCII character", token: "ghs_ä" },
  ])("readCachedToken treats a row that decrypts to $case as no cached token", async ({ token }) => {
    const key = await keyFor(SECRET);
    const sealed = await encrypt(key, token, tokenContext(INSTALLATION, EXPIRES_AT));
    await env.DB.prepare(
      "INSERT INTO token_cache (installation_id, iv, ciphertext, expires_at) VALUES (?1, ?2, ?3, ?4)",
    )
      .bind(INSTALLATION, sealed.iv, sealed.ciphertext, EXPIRES_AT)
      .run();

    const cached = await readCachedToken(env.DB, key, INSTALLATION);

    expect(cached, "cached token").toBeUndefined();
  });

  it("readCachedToken reads a token of 255 characters", async () => {
    const key = await keyFor(SECRET);
    const token = "a".repeat(255);
    await seedCachedToken(env.DB, key, INSTALLATION, token, EXPIRES_AT);

    const cached = await readCachedToken(env.DB, key, INSTALLATION);

    expect(cached?.token, "token").toBe(token);
  });

  it("readCachedToken lets a D1 error reach the caller", async () => {
    const pending = readCachedToken(migrationTestDb(), await keyFor(SECRET), INSTALLATION);

    await expect(pending, "result").rejects.toThrow(/no such table/i);
  });
});

describe("deleteCachedToken", () => {
  it("deleteCachedToken deletes the row while it still has the IV", async () => {
    const iv = await seedCachedToken(env.DB, await keyFor(SECRET), INSTALLATION, TOKEN, EXPIRES_AT);

    await deleteCachedToken(env.DB, INSTALLATION, iv);

    expect(await tokenRows(env.DB), "rows").toEqual([]);
  });

  it("deleteCachedToken leaves a row that has another IV", async () => {
    const key = await keyFor(SECRET);
    const oldIv = await seedCachedToken(env.DB, key, INSTALLATION, TOKEN, EXPIRES_AT);
    const newIv = await seedCachedToken(env.DB, key, INSTALLATION, "ghs_new", EXPIRES_AT);

    await deleteCachedToken(env.DB, INSTALLATION, oldIv);

    const row = await rowOrFail();
    expect(row?.iv, "iv of the remaining row").toBe(newIv);
  });

  it("deleteCachedToken leaves the row of another installation, also with the same IV", async () => {
    const key = await keyFor(SECRET);
    const iv = await seedCachedToken(env.DB, key, INSTALLATION, TOKEN, EXPIRES_AT);
    await env.DB.prepare(
      "INSERT INTO token_cache (installation_id, iv, ciphertext, expires_at) VALUES (?1, ?2, 'x', 1)",
    )
      .bind(OTHER_INSTALLATION, iv)
      .run();

    await deleteCachedToken(env.DB, INSTALLATION, iv);

    expect(
      (await tokenRows(env.DB)).map((row) => row.installationId),
      "remaining installations",
    ).toEqual([OTHER_INSTALLATION]);
  });

  it("deleteCachedToken does nothing without a row", async () => {
    const pending = deleteCachedToken(env.DB, INSTALLATION, "AAAAAAAAAAAAAAAA");

    await expect(pending, "result").resolves.toBeUndefined();
  });

  it("deleteCachedToken lets a D1 error reach the caller", async () => {
    const pending = deleteCachedToken(migrationTestDb(), INSTALLATION, "AAAAAAAAAAAAAAAA");

    await expect(pending, "result").rejects.toThrow(/no such table/i);
  });
});
