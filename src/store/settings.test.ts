import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { readSetting, writeSetting } from "./settings";
import { applyMigrations, migrationTestDb } from "../../test/d1";

const KEY = "example_key";

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.prepare("DELETE FROM settings").run();
});

/** The stored value of `key` read with plain SQL, or `undefined` when there is no row. */
async function storedValue(key: string): Promise<unknown> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?1").bind(key).first();
  return row?.value;
}

async function rowCount(): Promise<unknown> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM settings").first();
  return row?.total;
}

describe("readSetting", () => {
  it("readSetting returns undefined for a key never written", async () => {
    const value = await readSetting(env.DB, KEY);

    expect(value, "value").toBeUndefined();
  });

  it("readSetting returns the text stored under the key and nothing of other keys", async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2), (?3, ?4)")
      .bind(KEY, "-1001234567890", "other_key", "other")
      .run();

    const value = await readSetting(env.DB, KEY);

    expect(value, "value").toBe("-1001234567890");
  });

  it("readSetting returns an empty stored text as an empty text", async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2)").bind(KEY, "").run();

    const value = await readSetting(env.DB, KEY);

    expect(value, "value").toBe("");
  });
});

describe("writeSetting", () => {
  it("writeSetting stores a value and a second write replaces it", async () => {
    await writeSetting(env.DB, KEY, "first");

    await writeSetting(env.DB, KEY, "second");

    expect(await storedValue(KEY), "stored value").toBe("second");
    expect(await rowCount(), "number of rows").toBe(1);
  });

  it("writeSetting leaves the other keys alone", async () => {
    await writeSetting(env.DB, "other_key", "other");

    await writeSetting(env.DB, KEY, "value");

    expect(await storedValue("other_key"), "other value").toBe("other");
    expect(await readSetting(env.DB, KEY), "read back").toBe("value");
  });
});

describe("readSetting and writeSetting with a failing database", () => {
  it("readSetting and writeSetting pass D1 errors on: readSetting", async () => {
    await expect(readSetting(migrationTestDb(), KEY), "read on a database without tables").rejects.toThrow(
      /no such table/i,
    );
  });

  it("readSetting and writeSetting pass D1 errors on: writeSetting", async () => {
    await expect(writeSetting(migrationTestDb(), KEY, "value"), "write on a database without tables").rejects.toThrow(
      /no such table/i,
    );
  });
});
