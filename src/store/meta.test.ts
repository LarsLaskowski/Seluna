import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { GITHUB_APP_SLUG_META_KEY, LAST_DELIVERY_META_KEY, readAppSlug, readLastDelivery, writeAppSlug } from "./meta";
import { applyMigrations } from "../../test/d1";

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.prepare("DELETE FROM meta WHERE key IN (?1, ?2)")
    .bind(LAST_DELIVERY_META_KEY, GITHUB_APP_SLUG_META_KEY)
    .run();
});

async function putMeta(key: string, value: string): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)").bind(key, value).run();
}

async function storedMeta(key: string): Promise<unknown> {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = ?1").bind(key).first();
  return row?.value;
}

describe("readLastDelivery", () => {
  it.each([
    { case: "the time stored", stored: "1792240440000", expected: 1_792_240_440_000 },
    { case: "the latest time a Date holds", stored: "8640000000000000", expected: 8_640_000_000_000_000 },
    { case: "the epoch", stored: "0", expected: 0 },
    { case: "undefined for a text that is not a number", stored: "abc", expected: undefined },
    { case: "undefined for a negative number", stored: "-1", expected: undefined },
    { case: "undefined for a number with a leading zero", stored: "01", expected: undefined },
    { case: "undefined for an exponent", stored: "1e3", expected: undefined },
    { case: "undefined for a time above the latest a Date holds", stored: "8640000000000001", expected: undefined },
    { case: "undefined for the largest safe integer", stored: "9007199254740991", expected: undefined },
    { case: "undefined for a number beyond the safe integers", stored: "9007199254740993", expected: undefined },
  ])("readLastDelivery returns $case", async ({ stored, expected }) => {
    await putMeta(LAST_DELIVERY_META_KEY, stored);

    const time = await readLastDelivery(env.DB);

    expect(time?.getTime(), "time in milliseconds").toBe(expected);
  });

  it("readLastDelivery returns undefined when no row is stored", async () => {
    const time = await readLastDelivery(env.DB);

    expect(time, "time").toBeUndefined();
  });
});

describe("readAppSlug", () => {
  it.each([
    { name: "its App ID", stored: "12345:seluna-demo", appId: 12_345, expected: "seluna-demo" },
    { name: "another App ID", stored: "12345:seluna-demo", appId: 54_321, expected: undefined },
    { name: "an App ID that only starts the same", stored: "12345:seluna-demo", appId: 1234, expected: undefined },
    { name: "a slug with capital letters", stored: "12345:Seluna", appId: 12_345, expected: undefined },
    { name: "a slug with an underscore", stored: "12345:seluna_demo", appId: 12_345, expected: undefined },
    { name: "an empty slug", stored: "12345:", appId: 12_345, expected: undefined },
    { name: "a slug of 101 characters", stored: `12345:${"a".repeat(101)}`, appId: 12_345, expected: undefined },
    { name: "a value without a colon", stored: "seluna-demo", appId: 12_345, expected: undefined },
  ])("readAppSlug returns the slug only for its App ID: $name", async ({ stored, appId, expected }) => {
    await putMeta(GITHUB_APP_SLUG_META_KEY, stored);

    const slug = await readAppSlug(env.DB, appId);

    expect(slug, "slug").toBe(expected);
  });

  it("readAppSlug returns the slug of 100 characters", async () => {
    await putMeta(GITHUB_APP_SLUG_META_KEY, `12345:${"a".repeat(100)}`);

    const slug = await readAppSlug(env.DB, 12_345);

    expect(slug, "slug").toBe("a".repeat(100));
  });

  it("readAppSlug returns undefined when no row is stored", async () => {
    const slug = await readAppSlug(env.DB, 12_345);

    expect(slug, "slug").toBeUndefined();
  });
});

describe("writeAppSlug", () => {
  it("writeAppSlug replaces an earlier slug", async () => {
    await writeAppSlug(env.DB, 1, "first-app");

    await writeAppSlug(env.DB, 2, "second-app");

    expect(await storedMeta(GITHUB_APP_SLUG_META_KEY), "stored value").toBe("2:second-app");
    expect(await readAppSlug(env.DB, 2), "slug read back").toBe("second-app");
  });
});
