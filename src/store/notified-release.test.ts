import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { NOTIFIED_RELEASE_META_KEY, readNotifiedRelease, recordReleaseNotice } from "./notified-release";
import type { NewOutboxRow } from "./outbox";
import { applyMigrations } from "../../test/d1";

const CREATED_AT = new Date("2026-10-21T05:17:00Z");
const NOTICE: NewOutboxRow = {
  text: "<b>New Seluna release</b> · LarsLaskowski/Seluna\nVersion 0.5.0 is available; this instance runs 0.4.0.",
  buttonUrl: "https://github.com/LarsLaskowski/Seluna/releases/tag/v0.5.0",
  silent: false,
};

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([env.DB.prepare("DELETE FROM outbox"), env.DB.prepare("DELETE FROM meta")]);
});

/** A database whose `prepare` and `batch` fail, the others are not supported. */
function failingDatabase(): D1Database {
  const failed = (): never => {
    throw new Error("The database failed");
  };
  return {
    prepare: failed,
    batch: () => Promise.reject(new Error("The database failed")),
    exec: failed,
    dump: failed,
    withSession: failed,
  };
}

async function putRemembered(value: string): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)")
    .bind(NOTIFIED_RELEASE_META_KEY, value)
    .run();
}

async function remembered(): Promise<unknown> {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = ?1").bind(NOTIFIED_RELEASE_META_KEY).first();
  return row?.value;
}

async function outboxRows(): Promise<readonly unknown[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, text, button_url, silent, status, attempts, created_at FROM outbox ORDER BY id",
  ).all();
  return results;
}

describe("readNotifiedRelease", () => {
  it("readNotifiedRelease returns undefined when no version is remembered", async () => {
    const stored = await readNotifiedRelease(env.DB);

    expect(stored, "stored version").toBeUndefined();
  });

  it("readNotifiedRelease returns the remembered version", async () => {
    await putRemembered("0.5.0");

    const stored = await readNotifiedRelease(env.DB);

    expect(stored, "stored version").toBe("0.5.0");
  });

  it("readNotifiedRelease returns a value of another form as stored", async () => {
    await putRemembered("garbage");

    const stored = await readNotifiedRelease(env.DB);

    expect(stored, "stored value").toBe("garbage");
  });

  it("readNotifiedRelease rejects when the database fails", async () => {
    await expect(readNotifiedRelease(failingDatabase()), "read").rejects.toThrow("The database failed");
  });
});

describe("recordReleaseNotice (AC6: both writes or neither)", () => {
  it("recordReleaseNotice writes the row and the version and returns the row id when nothing was remembered", async () => {
    const id = await recordReleaseNotice(env.DB, NOTICE, CREATED_AT, "0.5.0");

    expect(typeof id, "type of the id").toBe("number");
    expect(await outboxRows(), "outbox rows").toEqual([
      {
        id,
        text: NOTICE.text,
        button_url: NOTICE.buttonUrl,
        silent: 0,
        status: "pending",
        attempts: 0,
        created_at: CREATED_AT.getTime(),
      },
    ]);
    expect(await remembered(), "remembered version").toBe("0.5.0");
  });

  it("recordReleaseNotice replaces the remembered version when it still holds the expected value", async () => {
    await putRemembered("0.5.0");

    const id = await recordReleaseNotice(env.DB, NOTICE, CREATED_AT, "0.6.0", "0.5.0");

    expect(typeof id, "type of the id").toBe("number");
    expect(await outboxRows(), "number of rows").toHaveLength(1);
    expect(await remembered(), "remembered version").toBe("0.6.0");
  });

  it("recordReleaseNotice replaces a remembered value of another form when it is the expected one", async () => {
    await putRemembered("garbage");

    const id = await recordReleaseNotice(env.DB, NOTICE, CREATED_AT, "0.5.0", "garbage");

    expect(typeof id, "type of the id").toBe("number");
    expect(await remembered(), "remembered version").toBe("0.5.0");
  });

  it("recordReleaseNotice writes a row without button as NULL", async () => {
    const id = await recordReleaseNotice(env.DB, { ...NOTICE, buttonUrl: undefined }, CREATED_AT, "0.5.0");

    expect(typeof id, "type of the id").toBe("number");
    expect(await outboxRows(), "outbox rows").toMatchObject([{ button_url: null }]);
  });

  it("recordReleaseNotice writes neither and returns undefined when another value is remembered", async () => {
    await putRemembered("0.6.0");

    const id = await recordReleaseNotice(env.DB, NOTICE, CREATED_AT, "0.5.0", "0.4.0");

    expect(id, "id").toBeUndefined();
    expect(await outboxRows(), "outbox rows").toEqual([]);
    expect(await remembered(), "remembered version").toBe("0.6.0");
  });

  it("recordReleaseNotice writes neither and returns undefined when a version appeared after nothing was read", async () => {
    await putRemembered("0.5.0");

    const id = await recordReleaseNotice(env.DB, NOTICE, CREATED_AT, "0.6.0");

    expect(id, "id").toBeUndefined();
    expect(await outboxRows(), "outbox rows").toEqual([]);
    expect(await remembered(), "remembered version").toBe("0.5.0");
  });

  it("recordReleaseNotice writes neither and returns undefined when a version was read and none is remembered now", async () => {
    const id = await recordReleaseNotice(env.DB, NOTICE, CREATED_AT, "0.5.0", "0.4.0");

    expect(id, "id").toBeUndefined();
    expect(await outboxRows(), "outbox rows").toEqual([]);
    expect(await remembered(), "remembered version").toBeUndefined();
  });

  it("recordReleaseNotice rejects and writes nothing when the database fails", async () => {
    await expect(recordReleaseNotice(failingDatabase(), NOTICE, CREATED_AT, "0.5.0"), "record").rejects.toThrow(
      "The database failed",
    );
    expect(await outboxRows(), "outbox rows").toEqual([]);
  });
});
