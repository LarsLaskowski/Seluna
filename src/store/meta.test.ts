import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DIGEST_RUN_META_KEY,
  digestRunUpsert,
  GITHUB_APP_OWNER_META_KEY,
  GITHUB_APP_SLUG_META_KEY,
  LAST_DELIVERY_META_KEY,
  lastDeliveryUpsert,
  readAppOwner,
  readAppSlug,
  readDigestRun,
  readLastDelivery,
  writeAppOwner,
  writeAppSlug,
} from "./meta";
import { applyMigrations } from "../../test/d1";

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.prepare("DELETE FROM meta WHERE key IN (?1, ?2, ?3)")
    .bind(LAST_DELIVERY_META_KEY, GITHUB_APP_SLUG_META_KEY, GITHUB_APP_OWNER_META_KEY)
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

describe("writeAppOwner and readAppOwner", () => {
  it("GITHUB_APP_OWNER_META_KEY names the row github_app_owner", () => {
    expect(GITHUB_APP_OWNER_META_KEY, "key").toBe("github_app_owner");
  });

  it("writeAppOwner and readAppOwner round-trip an owner", async () => {
    await writeAppOwner(env.DB, 12_345, { id: 583_231, login: "octocat", type: "User" });

    const owner = await readAppOwner(env.DB, 12_345);

    expect(await storedMeta(GITHUB_APP_OWNER_META_KEY), "stored value").toBe("12345:583231:User:octocat");
    expect(owner, "owner read back").toEqual({ id: 583_231, login: "octocat", type: "User" });
  });

  it("writeAppOwner and readAppOwner round-trip an organization", async () => {
    await writeAppOwner(env.DB, 7, { id: 9, login: "Octo-Org", type: "Organization" });

    const owner = await readAppOwner(env.DB, 7);

    expect(await storedMeta(GITHUB_APP_OWNER_META_KEY), "stored value").toBe("7:9:Organization:Octo-Org");
    expect(owner, "owner read back").toEqual({ id: 9, login: "Octo-Org", type: "Organization" });
  });

  it("writeAppOwner replaces an earlier owner", async () => {
    await writeAppOwner(env.DB, 1, { id: 10, login: "first-owner", type: "User" });

    await writeAppOwner(env.DB, 2, { id: 20, login: "second-owner", type: "Organization" });

    expect(await storedMeta(GITHUB_APP_OWNER_META_KEY), "stored value").toBe("2:20:Organization:second-owner");
    expect(await readAppOwner(env.DB, 1), "owner of the first App ID").toBeUndefined();
    expect(await readAppOwner(env.DB, 2), "owner of the second App ID").toEqual({
      id: 20,
      login: "second-owner",
      type: "Organization",
    });
  });

  it.each([
    { name: "a different App ID", appId: 54_321 },
    { name: "an App ID that only starts the same", appId: 1234 },
    { name: "an App ID that only ends the same", appId: 2345 },
  ])("readAppOwner ignores an owner of another App ID: $name", async ({ appId }) => {
    await putMeta(GITHUB_APP_OWNER_META_KEY, "12345:583231:User:octocat");

    const owner = await readAppOwner(env.DB, appId);

    expect(owner, "owner").toBeUndefined();
  });

  it.each([
    { case: "a value without colons", stored: "octocat" },
    { case: "a value without a login", stored: "12345:583231:User" },
    { case: "a value with an empty login", stored: "12345:583231:User:" },
    { case: "a value with an extra part", stored: "12345:583231:User:octocat:x" },
    { case: "an unknown type", stored: "12345:583231:Bot:octocat" },
    { case: "a type in lowercase", stored: "12345:583231:user:octocat" },
    { case: "an owner id of 0", stored: "12345:0:User:octocat" },
    { case: "a negative owner id", stored: "12345:-1:User:octocat" },
    { case: "a fractional owner id", stored: "12345:1.5:User:octocat" },
    { case: "an owner id with a leading zero", stored: "12345:01:User:octocat" },
    { case: "an owner id beyond the safe integers", stored: "12345:9007199254740993:User:octocat" },
    { case: "an owner id that is not a number", stored: "12345:abc:User:octocat" },
    { case: "a login with a trailing hyphen", stored: "12345:583231:User:octocat-" },
    { case: "a login with a slash", stored: "12345:583231:User:octo/cat" },
    { case: "a login of 40 characters", stored: `12345:583231:User:${"a".repeat(40)}` },
    { case: "a login with a trailing line feed", stored: "12345:583231:User:octocat\n" },
  ])("readAppOwner reads $case as absent", async ({ stored }) => {
    await putMeta(GITHUB_APP_OWNER_META_KEY, stored);

    const owner = await readAppOwner(env.DB, 12_345);

    expect(owner, "owner").toBeUndefined();
  });

  it("readAppOwner returns undefined when no row is stored", async () => {
    const owner = await readAppOwner(env.DB, 12_345);

    expect(owner, "owner").toBeUndefined();
  });

  it("writeAppOwner leaves the slug row alone", async () => {
    await writeAppSlug(env.DB, 12_345, "seluna-demo");

    await writeAppOwner(env.DB, 12_345, { id: 1, login: "octocat", type: "User" });

    expect(await storedMeta(GITHUB_APP_SLUG_META_KEY), "slug row").toBe("12345:seluna-demo");
  });
});

describe("lastDeliveryUpsert", () => {
  it("lastDeliveryUpsert stores the time readLastDelivery reads", async () => {
    await putMeta(LAST_DELIVERY_META_KEY, "1000");
    const time = new Date(1_792_240_440_000);

    await env.DB.batch([lastDeliveryUpsert(env.DB, time)]);

    expect(await storedMeta(LAST_DELIVERY_META_KEY), "stored text").toBe("1792240440000");
    expect((await readLastDelivery(env.DB))?.getTime(), "time read back").toBe(1_792_240_440_000);
  });
});

describe("readDigestRun", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM meta WHERE key = ?1").bind(DIGEST_RUN_META_KEY).run();
  });

  it("DIGEST_RUN_META_KEY names the row activity_digest_run", () => {
    expect(DIGEST_RUN_META_KEY, "key").toBe("activity_digest_run");
  });

  it.each([
    { case: "the time stored", stored: "1792240440000", expected: 1_792_240_440_000 },
    { case: "the latest time a Date holds", stored: "8640000000000000", expected: 8_640_000_000_000_000 },
    { case: "the epoch", stored: "0", expected: 0 },
    { case: "undefined for a text that is not a number", stored: "abc", expected: undefined },
    { case: "undefined for a negative number", stored: "-1", expected: undefined },
    { case: "undefined for a number with a leading zero", stored: "01", expected: undefined },
    { case: "undefined for an exponent", stored: "1e3", expected: undefined },
    { case: "undefined for the empty text", stored: "", expected: undefined },
    { case: "undefined for a time above the latest a Date holds", stored: "8640000000000001", expected: undefined },
  ])("readDigestRun returns $case", async ({ stored, expected }) => {
    await putMeta(DIGEST_RUN_META_KEY, stored);

    const time = await readDigestRun(env.DB);

    expect(time?.getTime(), "time in milliseconds").toBe(expected);
  });

  it("readDigestRun returns undefined when no row is stored", async () => {
    const time = await readDigestRun(env.DB);

    expect(time, "time").toBeUndefined();
  });

  it("readDigestRun ignores the last delivery row", async () => {
    await putMeta(LAST_DELIVERY_META_KEY, "1792240440000");

    const time = await readDigestRun(env.DB);

    expect(time, "time").toBeUndefined();
  });

  it("digestRunUpsert stores the time as decimal milliseconds and a second upsert replaces it", async () => {
    await digestRunUpsert(env.DB, new Date(1_792_240_440_000)).run();
    await digestRunUpsert(env.DB, new Date(1_792_241_040_000)).run();

    expect(await storedMeta(DIGEST_RUN_META_KEY), "stored value").toBe("1792241040000");
    expect((await readDigestRun(env.DB))?.getTime(), "read back").toBe(1_792_241_040_000);
  });

  it("digestRunUpsert leaves last_delivery alone and can run in a batch", async () => {
    await putMeta(LAST_DELIVERY_META_KEY, "5");

    await env.DB.batch([digestRunUpsert(env.DB, new Date(7))]);

    expect(await storedMeta(LAST_DELIVERY_META_KEY), "last delivery").toBe("5");
    expect(await storedMeta(DIGEST_RUN_META_KEY), "digest run").toBe("7");
  });
});
