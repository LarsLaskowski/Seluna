import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, migrationTestDb } from "../../test/d1";
import { keyFor } from "../../test/keys";
import { DEFAULT_SETTINGS } from "../settings";
import { GITHUB_APP_SLUG_META_KEY, LAST_DELIVERY_META_KEY } from "../store/meta";
import { writeSecret } from "../store/secrets";
import type { StatusView } from "./status";
import { formatDeliveryTime, statusView } from "./status";

const SECRET = "throwaway-setup-secret-0123456789abcdef";
const OTHER_SECRET = "another-throwaway-secret-fedcba9876543210";
const VERSION = "1.2.3-test";
const WORKER_SECRETS = {
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----",
  GITHUB_WEBHOOK_SECRET: "worker-webhook-secret-value",
};

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM settings"),
    env.DB.prepare("DELETE FROM secrets"),
    env.DB.prepare("DELETE FROM meta"),
  ]);
});

async function putSetting(key: string, value: string): Promise<void> {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2)").bind(key, value).run();
}

async function putMeta(key: string, value: string): Promise<void> {
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES (?1, ?2)").bind(key, value).run();
}

async function seedAppId(secret: string, value: string): Promise<void> {
  const result = await writeSecret(env.DB, await keyFor(secret), "github_app_id", value);
  expect(result, "seeding github_app_id").toEqual({ kind: "ok" });
}

describe("statusView", () => {
  const EMPTY: Omit<StatusView, "version"> = {
    chat: { kind: "none" },
    app: { kind: "none" },
    lastDelivery: undefined,
    resetNeeded: false,
    settings: DEFAULT_SETTINGS,
  };

  it.each<{ case: string; prepare: () => Promise<void>; workerEnv?: object; expected: Partial<StatusView> }>([
    { case: "an empty database", prepare: () => Promise.resolve(), expected: {} },
    {
      case: "a saved chat",
      prepare: () => putSetting("telegram_chat_id", "-1001234567890"),
      expected: { chat: { kind: "saved", chatId: -1_001_234_567_890 } },
    },
    {
      case: "the Worker secret TELEGRAM_CHAT_ID",
      prepare: () => Promise.resolve(),
      workerEnv: { TELEGRAM_CHAT_ID: "987654321" },
      expected: { chat: { kind: "secret" } },
    },
    {
      case: "a saved app with its slug",
      prepare: async () => {
        await seedAppId(SECRET, "12345");
        await putMeta(GITHUB_APP_SLUG_META_KEY, "12345:seluna-demo");
      },
      expected: { app: { kind: "saved", appId: 12_345, slug: "seluna-demo" } },
    },
    {
      case: "a saved app whose slug belongs to another App ID",
      prepare: async () => {
        await seedAppId(SECRET, "12345");
        await putMeta(GITHUB_APP_SLUG_META_KEY, "999:other-app");
      },
      expected: { app: { kind: "saved", appId: 12_345, slug: undefined } },
    },
    {
      case: "a stored App ID that is not a number as no saved app",
      prepare: () => seedAppId(SECRET, "not-a-number"),
      expected: { app: { kind: "none" } },
    },
    {
      case: "all three GitHub Worker secrets",
      prepare: () => Promise.resolve(),
      workerEnv: WORKER_SECRETS,
      expected: { app: { kind: "worker-secrets" } },
    },
    {
      case: "one GitHub Worker secret",
      prepare: () => Promise.resolve(),
      workerEnv: { GITHUB_WEBHOOK_SECRET: "worker-webhook-secret-value" },
      expected: { app: { kind: "partial-worker-secrets" } },
    },
    {
      case: "a key check under another SELUNA_SECRET: reset needed and the app unreadable",
      prepare: () => seedAppId(OTHER_SECRET, "12345"),
      expected: { app: { kind: "unreadable" }, resetNeeded: true },
    },
    {
      case: "the last delivery stored",
      prepare: () => putMeta(LAST_DELIVERY_META_KEY, "1792240440000"),
      expected: { lastDelivery: new Date(1_792_240_440_000) },
    },
    {
      case: "the saved settings",
      prepare: async () => {
        await putSetting("notification_language", "de");
        await putSetting("time_zone", "Europe/Berlin");
      },
      expected: { settings: { ...DEFAULT_SETTINGS, language: "de", timeZone: "Europe/Berlin" } },
    },
  ])("statusView reports $case", async ({ prepare, workerEnv, expected }) => {
    await prepare();

    const view = await statusView({ SELUNA_SECRET: SECRET, ...workerEnv }, env.DB, await keyFor(SECRET), VERSION);

    expect(view, "status view").toEqual({ ...EMPTY, version: VERSION, ...expected });
  });

  it("statusView lets a D1 error reach the caller", async () => {
    const pending = statusView({ SELUNA_SECRET: SECRET }, migrationTestDb(), await keyFor(SECRET), VERSION);

    await expect(pending, "result").rejects.toThrow(/no such table/i);
  });
});

describe("formatDeliveryTime", () => {
  it.each([
    {
      case: "a summer time in Europe/Berlin",
      iso: "2026-10-17T12:34:00Z",
      zone: "Europe/Berlin",
      expected: "2026-10-17 14:34 (Europe/Berlin)",
    },
    {
      case: "midnight as 00 in Europe/Berlin",
      iso: "2026-10-24T22:00:00Z",
      zone: "Europe/Berlin",
      expected: "2026-10-25 00:00 (Europe/Berlin)",
    },
    {
      case: "a time after the change to winter time",
      iso: "2026-10-25T01:30:00Z",
      zone: "Europe/Berlin",
      expected: "2026-10-25 02:30 (Europe/Berlin)",
    },
    { case: "a time in UTC", iso: "2026-10-17T12:34:00Z", zone: "UTC", expected: "2026-10-17 12:34 (UTC)" },
  ])("formatDeliveryTime writes $case", ({ iso, zone, expected }) => {
    const text = formatDeliveryTime(new Date(iso), zone);

    expect(text, "text").toBe(expected);
  });

  it("formatDeliveryTime falls back to UTC when the runtime rejects the zone", () => {
    const text = formatDeliveryTime(new Date("2026-10-17T12:34:00Z"), "Mars/Base");

    expect(text, "text").toBe("2026-10-17 12:34 (UTC)");
  });

  it.each([{ zone: "UTC" }, { zone: "Europe/Berlin" }])(
    "formatDeliveryTime writes the latest valid time without throwing in $zone",
    ({ zone }) => {
      const text = formatDeliveryTime(new Date(8_640_000_000_000_000), zone);

      expect(text.endsWith(")"), "text ends with the zone in parentheses").toBe(true);
    },
  );
});
