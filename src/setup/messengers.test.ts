import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { activateChannel, channelOfForm } from "./messengers";
import type { ChannelList } from "../channels/channel";
import { TELEGRAM_CHANNEL } from "../channels/telegram";
import { DELIVERY_CHANNEL_SETTING, readSetting, writeSetting } from "../store/settings";
import { testChannel } from "../../test/channel";
import { applyMigrations, migrationTestDb } from "../../test/d1";

const TOKEN = "123456789:AAH-throwaway_token0123456789abcdefghij";
const READY_ENV = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "5001001" };

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.prepare("DELETE FROM settings").run();
});

function formOf(...fields: readonly (readonly [string, string])[]): URLSearchParams {
  return new URLSearchParams(fields.map(([name, value]) => [name, value]));
}

/** A database that counts the statements it prepares for the `settings` table that write. */
function countingWrites(): { readonly db: D1Database; writes(): number } {
  let writes = 0;
  const db: D1Database = {
    prepare: (query: string) => {
      if (/^\s*(?:INSERT|UPDATE|DELETE)/i.test(query)) {
        writes += 1;
      }
      return env.DB.prepare(query);
    },
    batch: (statements) => env.DB.batch(statements),
    exec: (query) => env.DB.exec(query),
    dump: () => Promise.reject(new Error("Not supported by this wrapper")),
    withSession: (constraint) => env.DB.withSession(constraint),
  };
  return { db, writes: () => writes };
}

describe("channelOfForm", () => {
  const second = testChannel({ id: "second" });
  const channels: ChannelList = [TELEGRAM_CHANNEL, second];

  it("channelOfForm accepts exactly one exact registered id", () => {
    const telegram = channelOfForm(formOf(["channel", "telegram"]), channels);
    const other = channelOfForm(formOf(["csrf", "x"], ["channel", "second"]), channels);

    expect(telegram, "telegram").toBe(TELEGRAM_CHANNEL);
    expect(other, "second").toBe(second);
  });

  it.each([
    { case: "missing", fields: [["csrf", "x"]] as const },
    { case: "empty", fields: [["channel", ""]] as const },
    { case: "unknown", fields: [["channel", "gotify"]] as const },
    { case: "padded at the start", fields: [["channel", " telegram"]] as const },
    { case: "padded at the end", fields: [["channel", "telegram "]] as const },
    { case: "upper-case", fields: [["channel", "TELEGRAM"]] as const },
    { case: "a path", fields: [["channel", "../telegram"]] as const },
    { case: "a path with a slash", fields: [["channel", "telegram/"]] as const },
    { case: "a prefix of an id", fields: [["channel", "tele"]] as const },
    { case: "under another field name", fields: [["Channel", "telegram"]] as const },
    {
      case: "repeated with the same id",
      fields: [
        ["channel", "telegram"],
        ["channel", "telegram"],
      ] as const,
    },
    {
      case: "repeated with two ids",
      fields: [
        ["channel", "telegram"],
        ["channel", "second"],
      ] as const,
    },
  ])("channelOfForm returns undefined when the channel field is $case", ({ fields }) => {
    const channel = channelOfForm(formOf(...fields), channels);

    expect(channel, "channel").toBeUndefined();
  });
});

describe("activateChannel", () => {
  it("activateChannel writes delivery_channel for a channel whose prepare is ready and answers activated", async () => {
    const second = testChannel({ id: "second", configured: true });

    const result = await activateChannel({}, env.DB, second, [TELEGRAM_CHANNEL, second]);

    expect(result, "result").toBe("activated");
    expect(await readSetting(env.DB, DELIVERY_CHANNEL_SETTING), "stored channel").toBe("second");
  });

  it("activateChannel activates Telegram when it is set up and another channel is active", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "second");
    const second = testChannel({ id: "second", configured: true });

    const result = await activateChannel(READY_ENV, env.DB, TELEGRAM_CHANNEL, [TELEGRAM_CHANNEL, second]);

    expect(result, "result").toBe("activated");
    expect(await readSetting(env.DB, DELIVERY_CHANNEL_SETTING), "stored channel").toBe("telegram");
  });

  it("activateChannel answers not-set-up and writes nothing for a channel whose prepare is unavailable", async () => {
    const second = testChannel({ id: "second", configured: false });

    const result = await activateChannel({}, env.DB, second, [TELEGRAM_CHANNEL, second]);

    expect(result, "result").toBe("not-set-up");
    expect(await readSetting(env.DB, DELIVERY_CHANNEL_SETTING), "stored channel").toBeUndefined();
  });

  it("activateChannel answers not-set-up for Telegram without a token or chat and keeps the active channel", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "second");
    const second = testChannel({ id: "second", configured: true });

    const result = await activateChannel({}, env.DB, TELEGRAM_CHANNEL, [TELEGRAM_CHANNEL, second]);

    expect(result, "result").toBe("not-set-up");
    expect(await readSetting(env.DB, DELIVERY_CHANNEL_SETTING), "stored channel").toBe("second");
  });

  it("activateChannel answers already-active and writes nothing for the active channel", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "second");
    const second = testChannel({ id: "second", configured: true });
    const counted = countingWrites();

    const result = await activateChannel({}, counted.db, second, [TELEGRAM_CHANNEL, second]);

    expect(result, "result").toBe("already-active");
    expect(counted.writes(), "writes").toBe(0);
  });

  it("activateChannel answers already-active for Telegram when no channel is stored, without a write", async () => {
    const counted = countingWrites();

    const result = await activateChannel(READY_ENV, counted.db, TELEGRAM_CHANNEL, [TELEGRAM_CHANNEL]);

    expect(result, "result").toBe("already-active");
    expect(counted.writes(), "writes").toBe(0);
    expect(await readSetting(env.DB, DELIVERY_CHANNEL_SETTING), "stored channel").toBeUndefined();
  });

  it("activateChannel answers already-active for an active channel that is not set up", async () => {
    const result = await activateChannel({}, env.DB, TELEGRAM_CHANNEL, [TELEGRAM_CHANNEL]);

    expect(result, "result").toBe("already-active");
  });

  it("activateChannel reads a stored id no channel has as Telegram", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "gone");

    const result = await activateChannel({}, env.DB, TELEGRAM_CHANNEL, [TELEGRAM_CHANNEL]);

    expect(result, "result").toBe("already-active");
  });

  it("activateChannel lets a D1 error reach the caller", async () => {
    const second = testChannel({ id: "second", configured: true });

    const pending = activateChannel({}, migrationTestDb(), second, [TELEGRAM_CHANNEL, second]);

    await expect(pending, "result").rejects.toThrow(/no such table/i);
  });
});
