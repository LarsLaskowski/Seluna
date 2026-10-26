import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  activeChannelOf,
  CHANNEL_ID_FORM,
  CHANNELS,
  DEFAULT_CHANNEL_ID,
  readActiveChannel,
  RESERVED_SETUP_SEGMENTS,
} from "./registry";
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

describe("CHANNELS", () => {
  it("CHANNELS holds telegram and DEFAULT_CHANNEL_ID names it", () => {
    expect(DEFAULT_CHANNEL_ID, "default id").toBe("telegram");
    expect(
      CHANNELS.map((channel) => channel.id),
      "ids",
    ).toEqual(["telegram"]);
    expect(CHANNELS[0].displayName, "display name").toBe("Telegram");
  });

  it("CHANNELS ids match the id form, avoid the reserved segments and set setupPath to /setup/<id>", () => {
    const ids = CHANNELS.map((channel) => channel.id);

    expect(
      ids.filter((id) => !CHANNEL_ID_FORM.test(id)),
      "ids outside the form",
    ).toEqual([]);
    expect(
      ids.filter((id) => RESERVED_SETUP_SEGMENTS.includes(id)),
      "reserved ids",
    ).toEqual([]);
    expect(
      CHANNELS.map((channel) => channel.setupPath),
      "setup paths",
    ).toEqual(ids.map((id) => `/setup/${id}`));
    expect(new Set(ids).size, "distinct ids").toBe(ids.length);
  });
});

describe("CHANNEL_ID_FORM and RESERVED_SETUP_SEGMENTS", () => {
  it.each(["a", "telegram", "a-b", "a1", `a${"b".repeat(31)}`])("CHANNEL_ID_FORM accepts %s", (id) => {
    expect(CHANNEL_ID_FORM.test(id), "accepted").toBe(true);
  });

  it.each(["", "A", "1a", "-a", "a_b", "a b", " a", "a ", "a/b", "../a", `a${"b".repeat(32)}`, "é"])(
    "CHANNEL_ID_FORM rejects %j",
    (id) => {
      expect(CHANNEL_ID_FORM.test(id), "accepted").toBe(false);
    },
  );

  it("RESERVED_SETUP_SEGMENTS holds the six paths the wizard owns", () => {
    expect(
      [...RESERVED_SETUP_SEGMENTS].sort((a, b) => a.localeCompare(b)),
      "reserved segments",
    ).toEqual(["channel", "github", "login", "logout", "reset", "settings"]);
  });
});
