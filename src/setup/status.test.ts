import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, migrationTestDb } from "../../test/d1";
import {
  FIXTURE_PEM,
  FIXTURE_PKCS8,
  githubApiDouble,
  installationEntry,
  jsonAnswer,
  REJECTED,
  RSA_4104_PKCS8,
} from "../../test/github";
import type { GitHubAnswer } from "../../test/github";
import { bearerOf, decodeJwt, jwtVerifies } from "../../test/jwt";
import { keyFor } from "../../test/keys";
import { DEFAULT_SETTINGS } from "../settings";
import { GITHUB_APP_SLUG_META_KEY, LAST_DELIVERY_META_KEY } from "../store/meta";
import { writeSecret, writeSecrets } from "../store/secrets";
import type { Installation } from "../github/installations";
import type { StatusGitHub, StatusView } from "./status";
import { formatDeliveryTime, messengersView, statusView } from "./status";
import type { MessengerEntry } from "./status";
import { TELEGRAM_CHANNEL } from "../channels/telegram";
import type { ChannelList } from "../channels/channel";
import { DELIVERY_CHANNEL_SETTING, TELEGRAM_CHAT_ID_SETTING } from "../store/settings";
import { testChannel } from "../../test/channel";

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

const BOT_TOKEN = "123456789:AAH-throwaway_token0123456789abcdefghij";
const OTHER_BOT_TOKEN = "987654321:BBH-other_throwaway_token0123456789abcd";

async function saveBotToken(secret: string, value: string): Promise<void> {
  const result = await writeSecret(env.DB, await keyFor(secret), "telegram_bot_token", value);
  expect(result, "seeding telegram_bot_token").toEqual({ kind: "ok" });
}

const GITHUB: StatusGitHub = {
  fetcher: () => Promise.reject(new Error("no GitHub request expected")),
  now: () => new Date(0),
};

const NOW = new Date("2026-10-19T12:00:00Z");
const NEXT_LINK = '<https://api.github.com/app/installations?per_page=100&page=2>; rel="next"';
const OCTOCAT: Installation = {
  id: 1,
  account: { kind: "login", login: "octocat", type: "User" },
  repositorySelection: "selected",
  suspended: false,
};
/** Worker secrets whose key imports. */
const USABLE_WORKER_SECRETS = { ...WORKER_SECRETS, GITHUB_APP_PRIVATE_KEY: FIXTURE_PEM };

async function saveApp(appId: string, privateKey: string): Promise<void> {
  const written = await writeSecrets(env.DB, await keyFor(SECRET), {
    github_app_id: appId,
    github_private_key: privateKey,
    github_webhook_secret: "webhook-secret-text",
  });
  expect(written, "seeding the credentials").toEqual({ kind: "ok" });
}

/** The Telegram entry of the messengers card: active by default. */
function telegramEntry(changes: Partial<MessengerEntry> = {}): MessengerEntry {
  return {
    id: "telegram",
    name: "Telegram",
    setupPath: "/setup/telegram",
    configured: false,
    active: true,
    removable: false,
    ...changes,
  };
}

describe("statusView", () => {
  const EMPTY: Omit<StatusView, "version"> = {
    botToken: "none",
    chat: { kind: "none" },
    app: { kind: "none" },
    lastDelivery: undefined,
    resetNeeded: false,
    settings: DEFAULT_SETTINGS,
    installations: { kind: "hidden" },
    messengers: { entries: [telegramEntry()], active: telegramEntry() },
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
      expected: { app: { kind: "saved", appId: 12_345, slug: "seluna-demo" }, installations: { kind: "unavailable" } },
    },
    {
      case: "a saved app whose slug belongs to another App ID",
      prepare: async () => {
        await seedAppId(SECRET, "12345");
        await putMeta(GITHUB_APP_SLUG_META_KEY, "999:other-app");
      },
      expected: { app: { kind: "saved", appId: 12_345, slug: undefined }, installations: { kind: "unavailable" } },
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
      expected: { app: { kind: "worker-secrets" }, installations: { kind: "key-unusable" } },
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
      case: "key matches, github_private_key altered: the app is saved and a reset is needed",
      prepare: async () => {
        const written = await writeSecrets(env.DB, await keyFor(SECRET), {
          github_app_id: "12345",
          github_private_key: "private-key-text",
          github_webhook_secret: "webhook-secret-text",
        });
        expect(written, "seeding the credentials").toEqual({ kind: "ok" });
        await putMeta(GITHUB_APP_SLUG_META_KEY, "12345:seluna-demo");
        await env.DB.prepare(
          "UPDATE secrets SET ciphertext = (CASE WHEN substr(ciphertext, 1, 1) = 'A' THEN 'B' ELSE 'A' END) || substr(ciphertext, 2) WHERE key = 'github_private_key'",
        ).run();
      },
      expected: {
        app: { kind: "saved", appId: 12_345, slug: "seluna-demo" },
        resetNeeded: true,
        installations: { kind: "key-unusable" },
      },
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
    const github = githubApiDouble({});

    const view = await statusView({ SELUNA_SECRET: SECRET, ...workerEnv }, env.DB, await keyFor(SECRET), VERSION, {
      fetcher: github.fetch,
      now: () => NOW,
    });

    expect(view, "status view").toEqual({ ...EMPTY, version: VERSION, ...expected });
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it.each<{ botToken: StatusView["botToken"]; case: string; workerEnv: object; prepare: () => Promise<void> }>([
    { botToken: "none", case: "nothing is set or saved", workerEnv: {}, prepare: () => Promise.resolve() },
    {
      botToken: "worker-secret",
      case: "TELEGRAM_BOT_TOKEN is a usable token",
      workerEnv: { TELEGRAM_BOT_TOKEN: BOT_TOKEN },
      prepare: () => Promise.resolve(),
    },
    {
      botToken: "worker-secret",
      case: "TELEGRAM_BOT_TOKEN is malformed",
      workerEnv: { TELEGRAM_BOT_TOKEN: "1:a/../setWebhook" },
      prepare: () => Promise.resolve(),
    },
    {
      botToken: "worker-secret",
      case: "TELEGRAM_BOT_TOKEN is set beside a saved token",
      workerEnv: { TELEGRAM_BOT_TOKEN: BOT_TOKEN },
      prepare: () => saveBotToken(SECRET, OTHER_BOT_TOKEN),
    },
    {
      botToken: "worker-secret",
      case: "TELEGRAM_BOT_TOKEN is set beside a token saved under another SELUNA_SECRET",
      workerEnv: { TELEGRAM_BOT_TOKEN: BOT_TOKEN },
      prepare: () => saveBotToken(OTHER_SECRET, OTHER_BOT_TOKEN),
    },
    {
      botToken: "saved",
      case: "a token is saved",
      workerEnv: {},
      prepare: () => saveBotToken(SECRET, OTHER_BOT_TOKEN),
    },
    {
      botToken: "unreadable",
      case: "a token is saved under another SELUNA_SECRET",
      workerEnv: {},
      prepare: () => saveBotToken(OTHER_SECRET, OTHER_BOT_TOKEN),
    },
    {
      botToken: "unreadable",
      case: "only the token row is damaged under a matching key check",
      workerEnv: {},
      prepare: async () => {
        await saveBotToken(SECRET, OTHER_BOT_TOKEN);
        await env.DB.prepare(
          "UPDATE secrets SET ciphertext = (CASE WHEN substr(ciphertext, 1, 1) = 'A' THEN 'B' ELSE 'A' END) || substr(ciphertext, 2) WHERE key = 'telegram_bot_token'",
        ).run();
      },
    },
    {
      botToken: "unreadable",
      case: "the saved value is not of the bot token form",
      workerEnv: {},
      prepare: () => saveBotToken(SECRET, "1:a/../setWebhook"),
    },
  ])("statusView reports the bot token as $botToken when $case", async ({ botToken, prepare, workerEnv }) => {
    await prepare();
    const github = githubApiDouble({});

    const view = await statusView({ SELUNA_SECRET: SECRET, ...workerEnv }, env.DB, await keyFor(SECRET), VERSION, {
      fetcher: github.fetch,
      now: () => NOW,
    });

    expect(view.botToken, "bot token status").toBe(botToken);
    expect(JSON.stringify(view), "status view as text").not.toContain(OTHER_BOT_TOKEN);
    expect(JSON.stringify(view), "status view as text").not.toContain(BOT_TOKEN);
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it("statusView lists the registered messengers it is given and the active one", async () => {
    await putSetting(DELIVERY_CHANNEL_SETTING, "test");
    const channel = testChannel({ configured: true });
    const channels: ChannelList = [TELEGRAM_CHANNEL, channel];

    const view = await statusView(
      { SELUNA_SECRET: SECRET },
      env.DB,
      await keyFor(SECRET),
      VERSION,
      { fetcher: GITHUB.fetcher, now: GITHUB.now },
      channels,
    );

    const test: MessengerEntry = {
      id: "test",
      name: "test",
      setupPath: "/setup/test",
      configured: true,
      active: true,
      removable: false,
    };
    expect(view.messengers, "messengers").toEqual({ entries: [telegramEntry({ active: false }), test], active: test });
  });

  it("statusView lets a D1 error reach the caller", async () => {
    const pending = statusView({ SELUNA_SECRET: SECRET }, migrationTestDb(), await keyFor(SECRET), VERSION, GITHUB);

    await expect(pending, "result").rejects.toThrow(/no such table/i);
  });
});

/** `statusView` for an environment with `workerEnv`, asking GitHub through `fetcher`. */
async function installationsOf(
  workerEnv: object,
  fetcher: StatusGitHub["fetcher"],
): Promise<StatusView["installations"]> {
  const view = await statusView({ SELUNA_SECRET: SECRET, ...workerEnv }, env.DB, await keyFor(SECRET), VERSION, {
    fetcher,
    now: () => NOW,
  });
  return view.installations;
}

describe("statusView installations", () => {
  it.each<{ case: string; workerEnv: object; prepare: () => Promise<void> }>([
    { case: "an app from Worker secrets", workerEnv: USABLE_WORKER_SECRETS, prepare: () => Promise.resolve() },
    { case: "a saved app", workerEnv: {}, prepare: () => saveApp("12345", FIXTURE_PKCS8) },
  ])("statusView lists the installations for $case", async ({ workerEnv, prepare }) => {
    await prepare();
    const github = githubApiDouble({
      installations: jsonAnswer(200, [
        installationEntry({ id: 20, account: { login: "octocat", type: "User" }, repository_selection: "all" }),
        installationEntry({ id: 10, account: { login: "octo-org", type: "Organization" } }),
      ]),
    });

    const installations = await installationsOf(workerEnv, github.fetch);

    expect(installations, "installations").toEqual({
      kind: "listed",
      installations: [
        { ...OCTOCAT, id: 20, repositorySelection: "all" },
        {
          id: 10,
          account: { kind: "login", login: "octo-org", type: "Organization" },
          repositorySelection: "selected",
          suspended: false,
        },
      ],
      more: false,
    });
    expect(
      github.requests.map((request) => request.url),
      "GitHub requests",
    ).toEqual(["https://api.github.com/app/installations?per_page=100"]);
  });

  it("statusView asks GitHub as the app with a JWT of the App ID", async () => {
    const github = githubApiDouble({ installations: jsonAnswer(200, [installationEntry()]) });

    await installationsOf(USABLE_WORKER_SECRETS, github.fetch);

    const [request, ...rest] = github.requests;
    expect(rest, "further requests").toEqual([]);
    const jwt = decodeJwt(bearerOf(request?.authorization ?? null) ?? "");
    expect(jwt?.claims, "JWT claims").toEqual({
      iat: NOW.getTime() / 1000 - 60,
      exp: NOW.getTime() / 1000 + 540,
      iss: 12_345,
    });
    expect(jwt === undefined ? false : await jwtVerifies(jwt), "JWT signature verifies").toBe(true);
    expect(request?.headers.get("user-agent"), "User-Agent").toBe("seluna/1.2.3-test");
  });

  it("statusView lists an empty answer as no installations", async () => {
    const github = githubApiDouble({ installations: jsonAnswer(200, []) });

    const installations = await installationsOf(USABLE_WORKER_SECRETS, github.fetch);

    expect(installations, "installations").toEqual({ kind: "listed", installations: [], more: false });
  });

  it("statusView reports more when the Link header names a next page", async () => {
    const github = githubApiDouble({ installations: jsonAnswer(200, [installationEntry()], { Link: NEXT_LINK }) });

    const installations = await installationsOf(USABLE_WORKER_SECRETS, github.fetch);

    expect(installations, "installations").toEqual({ kind: "listed", installations: [OCTOCAT], more: true });
  });

  const UNAVAILABLE_ANSWERS: readonly { readonly case: string; readonly answer: GitHubAnswer }[] = [
    { case: "GitHub refuses the app token with 401", answer: jsonAnswer(401, { message: "Bad credentials" }) },
    { case: "GitHub answers 403", answer: jsonAnswer(403, { message: "forbidden" }) },
    { case: "GitHub answers 500", answer: jsonAnswer(500, { message: "Server Error" }) },
    {
      case: "GitHub answers a redirect",
      answer: { kind: "raw", status: 302, body: null, headers: { Location: "https://example.com/" } },
    },
    { case: "the request fails", answer: REJECTED },
    { case: "the request times out", answer: { kind: "reject", error: new DOMException("timed out", "TimeoutError") } },
    { case: "the answer is not JSON", answer: { kind: "raw", status: 200, body: "not json" } },
    { case: "the answer is not a list", answer: jsonAnswer(200, { installations: [] }) },
    {
      case: "an entry has no id",
      answer: jsonAnswer(200, [installationEntry(), installationEntry({ id: undefined })]),
    },
  ];

  it.each(UNAVAILABLE_ANSWERS)("statusView shows installations unavailable when $case", async ({ answer }) => {
    const github = githubApiDouble({ installations: answer });

    const installations = await installationsOf(USABLE_WORKER_SECRETS, github.fetch);

    expect(installations, "installations").toEqual({ kind: "unavailable" });
    expect(github.requests.length, "number of GitHub requests").toBe(1);
  });

  it.each([
    { case: "0", appId: "0" },
    { case: "a word", appId: "abc" },
    { case: "a number with a leading zero", appId: "012345" },
  ])("statusView shows installations unavailable without a request when GITHUB_APP_ID is $case", async ({ appId }) => {
    const github = githubApiDouble({});

    const installations = await installationsOf({ ...USABLE_WORKER_SECRETS, GITHUB_APP_ID: appId }, github.fetch);

    expect(installations, "installations").toEqual({ kind: "unavailable" });
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it("statusView shows installations unavailable without a request for a saved app without a key", async () => {
    await saveApp("12345", FIXTURE_PKCS8);
    await env.DB.prepare("DELETE FROM secrets WHERE key = 'github_private_key'").run();
    const github = githubApiDouble({});

    const installations = await installationsOf({}, github.fetch);

    expect(installations, "installations").toEqual({ kind: "unavailable" });
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it.each<{ case: string; workerEnv: object; prepare: () => Promise<void> }>([
    {
      case: "a Worker secret key that is no PEM",
      workerEnv: { ...WORKER_SECRETS, GITHUB_APP_PRIVATE_KEY: "not a pem" },
      prepare: () => Promise.resolve(),
    },
    {
      case: "a Worker secret key of more than 4096 bits",
      workerEnv: { ...WORKER_SECRETS, GITHUB_APP_PRIVATE_KEY: RSA_4104_PKCS8 },
      prepare: () => Promise.resolve(),
    },
    { case: "a saved key that is no key", workerEnv: {}, prepare: () => saveApp("12345", "private-key-text") },
    { case: "a saved key of more than 4096 bits", workerEnv: {}, prepare: () => saveApp("12345", RSA_4104_PKCS8) },
    {
      case: "a saved key whose ciphertext was altered",
      workerEnv: {},
      prepare: async () => {
        await saveApp("12345", FIXTURE_PKCS8);
        await env.DB.prepare(
          "UPDATE secrets SET ciphertext = (CASE WHEN substr(ciphertext, 1, 1) = 'A' THEN 'B' ELSE 'A' END) || substr(ciphertext, 2) WHERE key = 'github_private_key'",
        ).run();
      },
    },
  ])("statusView shows key unusable for $case", async ({ workerEnv, prepare }) => {
    await prepare();
    const github = githubApiDouble({});

    const installations = await installationsOf(workerEnv, github.fetch);

    expect(installations, "installations").toEqual({ kind: "key-unusable" });
    expect(github.requests, "GitHub requests").toEqual([]);
  });

  it.each<{ case: string; workerEnv: object; prepare: () => Promise<void> }>([
    { case: "none saved yet", workerEnv: {}, prepare: () => Promise.resolve() },
    {
      case: "partial Worker secrets",
      workerEnv: { GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: FIXTURE_PEM },
      prepare: () => saveApp("54321", FIXTURE_PKCS8),
    },
    {
      case: "cannot be read",
      workerEnv: {},
      prepare: async () => {
        const written = await writeSecrets(env.DB, await keyFor(OTHER_SECRET), {
          github_app_id: "12345",
          github_private_key: FIXTURE_PKCS8,
          github_webhook_secret: "webhook-secret-text",
        });
        expect(written, "seeding the credentials").toEqual({ kind: "ok" });
      },
    },
  ])(
    "statusView hides the installations and calls GitHub for nothing when the app is $case",
    async ({ workerEnv, prepare }) => {
      await prepare();
      const github = githubApiDouble({ installations: jsonAnswer(200, [installationEntry()]) });

      const installations = await installationsOf(workerEnv, github.fetch);

      expect(installations, "installations").toEqual({ kind: "hidden" });
      expect(github.requests, "GitHub requests").toEqual([]);
    },
  );

  it("statusView lets a D1 error reach the caller although GitHub would answer", async () => {
    const github = githubApiDouble({ installations: jsonAnswer(200, []) });

    const pending = statusView({ SELUNA_SECRET: SECRET }, migrationTestDb(), await keyFor(SECRET), VERSION, {
      fetcher: github.fetch,
      now: () => NOW,
    });

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

/** The Worker environment of a set-up Telegram: a usable token and a chat. */
const TELEGRAM_READY_ENV = { SELUNA_SECRET: SECRET, TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_CHAT_ID: "987654321" };

describe("messengersView", () => {
  it("messengersView lists Telegram alone as active and not set up when nothing is set up", async () => {
    const view = await messengersView({ SELUNA_SECRET: SECRET }, env.DB, [TELEGRAM_CHANNEL]);

    expect(view, "messengers").toEqual({ entries: [telegramEntry()], active: telegramEntry() });
  });

  it("messengersView lists every registered channel in the registry order, also one that is not set up", async () => {
    const first = testChannel({ id: "first", configured: false });
    const second = testChannel({ id: "second", configured: true });

    const view = await messengersView({ SELUNA_SECRET: SECRET }, env.DB, [first, TELEGRAM_CHANNEL, second]);

    expect(
      view.entries.map((entry) => [entry.id, entry.name, entry.setupPath, entry.configured, entry.active]),
      "entries",
    ).toEqual([
      ["first", "first", "/setup/first", false, false],
      ["telegram", "Telegram", "/setup/telegram", false, true],
      ["second", "second", "/setup/second", true, false],
    ]);
  });

  it("messengersView marks the channel the delivery_channel setting names as active and returns its entry", async () => {
    await putSetting(DELIVERY_CHANNEL_SETTING, "second");
    const second = testChannel({ id: "second", configured: true });

    const view = await messengersView({ SELUNA_SECRET: SECRET }, env.DB, [TELEGRAM_CHANNEL, second]);

    expect(
      view.entries.map((entry) => entry.active),
      "active flags",
    ).toEqual([false, true]);
    expect(view.active, "active entry").toBe(view.entries[1]);
  });

  it.each([
    { case: "an unknown id", stored: "gone" },
    { case: "an upper-case id", stored: "SECOND" },
    { case: "a padded id", stored: " second" },
    { case: "an empty id", stored: "" },
  ])("messengersView reads $case as telegram", async ({ stored }) => {
    await putSetting(DELIVERY_CHANNEL_SETTING, stored);
    const second = testChannel({ id: "second" });

    const view = await messengersView({ SELUNA_SECRET: SECRET }, env.DB, [TELEGRAM_CHANNEL, second]);

    expect(view.active.id, "active id").toBe("telegram");
    expect(
      view.entries.map((entry) => entry.active),
      "active flags",
    ).toEqual([true, false]);
  });

  it.each<{ case: string; workerEnv: object; prepare: () => Promise<void>; configured: boolean; removable: boolean }>([
    {
      case: "the Worker secrets for token and chat: set up and not removable",
      workerEnv: TELEGRAM_READY_ENV,
      prepare: () => Promise.resolve(),
      configured: true,
      removable: false,
    },
    {
      case: "a Worker secret token without a chat: not set up",
      workerEnv: { TELEGRAM_BOT_TOKEN: BOT_TOKEN },
      prepare: () => Promise.resolve(),
      configured: false,
      removable: false,
    },
    {
      case: "a saved token and a saved chat: set up and removable",
      workerEnv: {},
      prepare: async () => {
        await saveBotToken(SECRET, OTHER_BOT_TOKEN);
        await putSetting(TELEGRAM_CHAT_ID_SETTING, "5001001");
      },
      configured: true,
      removable: true,
    },
    {
      case: "a saved token without a chat: not set up but removable",
      workerEnv: {},
      prepare: () => saveBotToken(SECRET, OTHER_BOT_TOKEN),
      configured: false,
      removable: true,
    },
    {
      case: "a saved token that cannot be read: not set up and not removable",
      workerEnv: {},
      prepare: () => saveBotToken(OTHER_SECRET, OTHER_BOT_TOKEN),
      configured: false,
      removable: false,
    },
    {
      case: "a saved token whose own row is damaged: not set up but removable",
      workerEnv: {},
      prepare: async () => {
        await saveBotToken(SECRET, OTHER_BOT_TOKEN);
        await env.DB.prepare(
          "UPDATE secrets SET ciphertext = (CASE WHEN substr(ciphertext, 1, 1) = 'A' THEN 'B' ELSE 'A' END) || substr(ciphertext, 2) WHERE key = 'telegram_bot_token'",
        ).run();
      },
      configured: false,
      removable: true,
    },
    {
      case: "a Worker secret token beside a saved token: not removable",
      workerEnv: { TELEGRAM_BOT_TOKEN: BOT_TOKEN },
      prepare: () => saveBotToken(SECRET, OTHER_BOT_TOKEN),
      configured: false,
      removable: false,
    },
  ])("messengersView reports Telegram with $case", async ({ workerEnv, prepare, configured, removable }) => {
    await prepare();

    const view = await messengersView({ SELUNA_SECRET: SECRET, ...workerEnv }, env.DB, [TELEGRAM_CHANNEL]);

    expect(view.entries[0], "Telegram entry").toEqual(telegramEntry({ configured, removable }));
  });

  it("messengersView takes configured and removable of a channel from its own answers", async () => {
    const channel = testChannel({ id: "second", configured: true, removable: true });

    const view = await messengersView({ SELUNA_SECRET: SECRET }, env.DB, [TELEGRAM_CHANNEL, channel]);

    expect(view.entries[1], "entry").toEqual({
      id: "second",
      name: "second",
      setupPath: "/setup/second",
      configured: true,
      active: false,
      removable: true,
    });
  });

  it("messengersView puts no credential into its answer", async () => {
    await saveBotToken(SECRET, OTHER_BOT_TOKEN);

    const view = await messengersView({ ...TELEGRAM_READY_ENV }, env.DB, [TELEGRAM_CHANNEL]);

    expect(JSON.stringify(view), "view as text").not.toContain(OTHER_BOT_TOKEN);
    expect(JSON.stringify(view), "view as text").not.toContain(BOT_TOKEN);
  });

  it("messengersView lets a D1 error reach the caller", async () => {
    const pending = messengersView({ SELUNA_SECRET: SECRET }, migrationTestDb(), [TELEGRAM_CHANNEL]);

    await expect(pending, "result").rejects.toThrow(/no such table/i);
  });
});
