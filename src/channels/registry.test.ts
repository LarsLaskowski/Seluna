import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { activeChannelOf, CHANNELS, readActiveChannel } from "./registry";
import type { ChannelList } from "./channel";
import { TELEGRAM_CHANNEL } from "./telegram";
import { DELIVERY_CHANNEL_SETTING, writeSetting } from "../store/settings";
import { testChannel } from "../../test/channel";
import { applyMigrations } from "../../test/d1";

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.prepare("DELETE FROM settings").run();
});

const OTHER = testChannel({ id: "ntfy" });
const BOTH: ChannelList = [OTHER, TELEGRAM_CHANNEL];

describe("activeChannelOf", () => {
  it.each([
    { case: "absent", stored: undefined },
    { case: "unknown", stored: "gotify" },
    { case: "padded", stored: " telegram" },
    { case: "padded at the end", stored: "telegram " },
    { case: "upper-case", stored: "TELEGRAM" },
    { case: "empty", stored: "" },
    { case: "a path", stored: "../telegram" },
  ])("activeChannelOf returns telegram for a stored id that is $case", ({ stored }) => {
    const channel = activeChannelOf(CHANNELS, stored);

    expect(channel.id, "channel id").toBe("telegram");
  });

  it("activeChannelOf returns the registered channel the stored id names", () => {
    const channel = activeChannelOf(BOTH, "ntfy");

    expect(channel, "channel").toBe(OTHER);
  });

  it("activeChannelOf returns telegram, not the first channel, for an unknown id when telegram is registered", () => {
    const channel = activeChannelOf(BOTH, "gone");

    expect(channel, "channel").toBe(TELEGRAM_CHANNEL);
  });

  it("activeChannelOf returns the first channel for an unknown id when telegram is not registered", () => {
    const second = testChannel({ id: "second" });

    const channel = activeChannelOf([OTHER, second], "gone");

    expect(channel, "channel").toBe(OTHER);
  });
});

describe("readActiveChannel", () => {
  it("readActiveChannel returns telegram when no channel is stored", async () => {
    const channel = await readActiveChannel(env.DB, BOTH);

    expect(channel, "channel").toBe(TELEGRAM_CHANNEL);
  });

  it("readActiveChannel returns the stored channel", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "ntfy");

    const channel = await readActiveChannel(env.DB, BOTH);

    expect(channel, "channel").toBe(OTHER);
  });

  it("readActiveChannel returns telegram for a stored id no channel has", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "gone");

    const channel = await readActiveChannel(env.DB, BOTH);

    expect(channel, "channel").toBe(TELEGRAM_CHANNEL);
  });

  it("readActiveChannel rejects when the database fails", async () => {
    const failing: D1Database = {
      prepare: () => {
        throw new Error("The database failed");
      },
      batch: () => Promise.reject(new Error("The database failed")),
      exec: () => Promise.reject(new Error("The database failed")),
      dump: () => Promise.reject(new Error("The database failed")),
      withSession: () => {
        throw new Error("The database failed");
      },
    };

    await expect(readActiveChannel(failing, BOTH), "read").rejects.toThrow("The database failed");
  });
});
