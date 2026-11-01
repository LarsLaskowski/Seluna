import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { readNotificationSettings, readSetting, writeNotificationSettings, writeSetting } from "./settings";
import { DEFAULT_SETTINGS } from "../settings";
import type { NotificationSettings } from "../settings";
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

const CHANGED_SETTINGS: NotificationSettings = {
  language: "de",
  timeZone: "Europe/Berlin",
  quietHours: { start: "22:00", end: "07:00" },
  rules: { ...DEFAULT_SETTINGS.rules, dependabot_alert: false, ci_failed_pull_request: false },
  updateNotice: false,
  activityDigest: { kind: "daily", time: "06:45" },
};

describe("readNotificationSettings", () => {
  it("readNotificationSettings returns the defaults on an empty table", async () => {
    const settings = await readNotificationSettings(env.DB);

    expect(settings, "settings").toEqual(DEFAULT_SETTINGS);
  });

  it("readNotificationSettings returns a value written after an earlier read", async () => {
    await readNotificationSettings(env.DB);
    await writeSetting(env.DB, "notification_language", "de");

    const settings = await readNotificationSettings(env.DB);

    expect(settings.language, "language").toBe("de");
  });
});

describe("readNotificationSettings with rows of an earlier version", () => {
  it("readNotificationSettings reads the digest as daily at 18:00 and the star and fork switches as off without rows", async () => {
    await writeSetting(env.DB, "notification_language", "de");
    await writeSetting(env.DB, "rule_issue_opened", "off");

    const settings = await readNotificationSettings(env.DB);

    expect(settings.activityDigest, "digest").toEqual({ kind: "daily", time: "18:00" });
    expect(settings.rules.repository_starred, "star switch").toBe(false);
    expect(settings.rules.repository_forked, "fork switch").toBe(false);
    expect(settings.rules.issue_opened, "stored switch keeps its value").toBe(false);
  });

  it("readNotificationSettings reads an invalid stored digest as daily at 18:00 and keeps the stored switches", async () => {
    await writeSetting(env.DB, "activity_digest", "daily@24:00");
    await writeSetting(env.DB, "rule_repository_starred", "on");

    const settings = await readNotificationSettings(env.DB);

    expect(settings.activityDigest, "digest").toEqual({ kind: "daily", time: "18:00" });
    expect(settings.rules.repository_starred, "stored star switch").toBe(true);
  });
});

describe("writeNotificationSettings", () => {
  it("writeNotificationSettings then readNotificationSettings round-trips every field", async () => {
    await writeNotificationSettings(env.DB, CHANGED_SETTINGS);

    const settings = await readNotificationSettings(env.DB);

    expect(settings, "settings").toEqual(CHANGED_SETTINGS);
  });

  it.each([
    { digest: { kind: "immediate" } },
    { digest: { kind: "hourly" } },
    { digest: { kind: "daily", time: "00:00" } },
  ] as const)(
    "writeNotificationSettings then readNotificationSettings round-trips the digest $digest.kind",
    async ({ digest }) => {
      await writeNotificationSettings(env.DB, { ...CHANGED_SETTINGS, activityDigest: digest });

      const settings = await readNotificationSettings(env.DB);

      expect(settings.activityDigest, "digest").toEqual(digest);
    },
  );

  it("writeNotificationSettings stores the digest as text under activity_digest", async () => {
    await writeNotificationSettings(env.DB, CHANGED_SETTINGS);

    expect(await storedValue("activity_digest"), "stored digest").toBe("daily@06:45");
  });

  it("writeNotificationSettings writes the eighteen settings in one batch", async () => {
    const batchSizes: number[] = [];
    const db: D1Database = {
      prepare: (query) => env.DB.prepare(query),
      exec: (query) => env.DB.exec(query),
      withSession: (constraintOrBookmark) => env.DB.withSession(constraintOrBookmark),
      dump: () => Promise.reject(new Error("dump is deprecated and not forwarded")),
      batch: <T = unknown>(statements: D1PreparedStatement[]) => {
        batchSizes.push(statements.length);
        return env.DB.batch<T>(statements);
      },
    };

    await writeNotificationSettings(db, CHANGED_SETTINGS);

    expect(batchSizes, "batch calls and their statement counts").toEqual([18]);
    expect(await rowCount(), "number of rows").toBe(18);
  });

  it("writeNotificationSettings leaves the Telegram chat row alone", async () => {
    await writeSetting(env.DB, "telegram_chat_id", "5001001");

    await writeNotificationSettings(env.DB, CHANGED_SETTINGS);

    expect(await storedValue("telegram_chat_id"), "chat row").toBe("5001001");
  });
});
