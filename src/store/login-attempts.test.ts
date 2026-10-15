import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLoginAttempts,
  LOGIN_ATTEMPTS_META_KEY,
  LOGIN_LOCK_MS,
  MAX_FAILED_LOGINS,
  reserveLoginAttempt,
} from "./login-attempts";
import type { LoginAttempt } from "./login-attempts";
import { applyMigrations } from "../../test/d1";

const START = 1_700_000_000_000;

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.prepare("DELETE FROM meta WHERE key = ?1").bind(LOGIN_ATTEMPTS_META_KEY).run();
});

/** The stored value of the `login_attempts` row, or `undefined` when there is none. */
async function storedValue(): Promise<unknown> {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = ?1").bind(LOGIN_ATTEMPTS_META_KEY).first();
  return row?.value;
}

/** The stored value parsed as JSON. */
async function storedCount(): Promise<unknown> {
  const value = await storedValue();
  if (typeof value !== "string") {
    return value;
  }
  const parsed: unknown = JSON.parse(value);
  return parsed;
}

async function putValue(value: string): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)")
    .bind(LOGIN_ATTEMPTS_META_KEY, value)
    .run();
}

/** The results of `count` attempts one after the other, all at `milliseconds`. */
async function attempts(count: number, milliseconds: number): Promise<LoginAttempt[]> {
  const results: LoginAttempt[] = [];
  for (let index = 0; index < count; index++) {
    results.push(await reserveLoginAttempt(env.DB, new Date(milliseconds)));
  }
  return results;
}

describe("reserveLoginAttempt", () => {
  it("reserveLoginAttempt allows five attempts in a row and locks the sixth", async () => {
    const results = await attempts(MAX_FAILED_LOGINS + 1, START);

    expect(results, "results").toEqual(["allowed", "allowed", "allowed", "allowed", "allowed", "locked"]);
  });

  it("reserveLoginAttempt keeps the lock until 15 minutes after the fifth attempt", async () => {
    await attempts(MAX_FAILED_LOGINS, START);

    const justBefore = await reserveLoginAttempt(env.DB, new Date(START + LOGIN_LOCK_MS - 1));
    const atTheEnd = await reserveLoginAttempt(env.DB, new Date(START + LOGIN_LOCK_MS));

    expect(justBefore, "attempt 1 ms before the end of the lock").toBe("locked");
    expect(atTheEnd, "attempt at the end of the lock").toBe("allowed");
    expect(await storedCount(), "stored count").toEqual({ failures: 1, last: START + LOGIN_LOCK_MS });
  });

  it("reserveLoginAttempt does not extend the lock with rejected attempts", async () => {
    await attempts(MAX_FAILED_LOGINS, START);
    await reserveLoginAttempt(env.DB, new Date(START + 1));
    await reserveLoginAttempt(env.DB, new Date(START + 899_000));

    const result = await reserveLoginAttempt(env.DB, new Date(START + LOGIN_LOCK_MS));

    expect(result, "attempt 15 minutes after the fifth").toBe("allowed");
  });

  it("reserveLoginAttempt starts a new count when the last attempt is 15 minutes old", async () => {
    await attempts(4, START);

    const result = await reserveLoginAttempt(env.DB, new Date(START + LOGIN_LOCK_MS));

    expect(result, "result").toBe("allowed");
    expect(await storedCount(), "stored count").toEqual({ failures: 1, last: START + LOGIN_LOCK_MS });
  });

  it.each([
    { name: "not JSON", value: "five" },
    { name: "a JSON array", value: "[5,1700000000000]" },
    { name: "a negative failures", value: '{"failures":-1,"last":1700000000000}' },
    { name: "a fractional failures", value: '{"failures":1.5,"last":1700000000000}' },
    { name: "a last that is a string", value: '{"failures":5,"last":"1700000000000"}' },
    { name: "a last that is missing", value: '{"failures":5}' },
  ])("reserveLoginAttempt starts a new count for a stored value that is $name", async ({ value }) => {
    await putValue(value);

    const result = await reserveLoginAttempt(env.DB, new Date(START + 1000));

    expect(result, "result").toBe("allowed");
    expect(await storedCount(), "stored count").toEqual({ failures: 1, last: START + 1000 });
  });

  it("reserveLoginAttempt stores failures and last as a JSON object with integers in meta row login_attempts", async () => {
    await reserveLoginAttempt(env.DB, new Date(START));

    const value = await storedValue();

    expect(typeof value, "type of the stored value").toBe("string");
    const parsed: unknown = JSON.parse(String(value));
    expect(parsed, "parsed value").toEqual({ failures: 1, last: START });
    const types = await env.DB.prepare(
      "SELECT json_type(value, '$.failures') AS failures, json_type(value, '$.last') AS last FROM meta WHERE key = ?1",
    )
      .bind(LOGIN_ATTEMPTS_META_KEY)
      .first();
    expect(types, "SQLite types of failures and last").toEqual({ failures: "integer", last: "integer" });
    expect(String(value), "stored text has no decimal point").not.toContain(".");
  });

  it("reserveLoginAttempt allows exactly five of ten attempts sent at once", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => reserveLoginAttempt(env.DB, new Date(START))));

    expect(results.filter((result) => result === "allowed").length, "allowed attempts").toBe(5);
    expect(results.filter((result) => result === "locked").length, "locked attempts").toBe(5);
  });
});

describe("clearLoginAttempts", () => {
  it("clearLoginAttempts deletes the count so the next attempt is the first", async () => {
    await attempts(MAX_FAILED_LOGINS, START);

    await clearLoginAttempts(env.DB);

    expect(await storedValue(), "stored value").toBeUndefined();
    await reserveLoginAttempt(env.DB, new Date(START + 1));
    expect(await storedCount(), "stored count after the next attempt").toEqual({ failures: 1, last: START + 1 });
  });
});
