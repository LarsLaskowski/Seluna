import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations, migrationTestDb } from "../../test/d1";
import {
  appBody,
  FIXTURE_INSTALLATION_ACCESS,
  FIXTURE_PEM,
  FIXTURE_PKCS8,
  FULL_EVENTS,
  FULL_PERMISSIONS,
  githubApiDouble,
  installationEntry,
  installationWithAccess,
  jsonAnswer,
  REJECTED,
  RSA_4104_PKCS8,
} from "../../test/github";
import type { GitHubAnswer, GitHubDouble } from "../../test/github";
import { bearerOf, decodeJwt, jwtVerifies } from "../../test/jwt";
import { keyFor } from "../../test/keys";
import { DEFAULT_SETTINGS } from "../settings";
import { GITHUB_APP_OWNER_META_KEY, GITHUB_APP_SLUG_META_KEY, LAST_DELIVERY_META_KEY } from "../store/meta";
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
    env.DB.prepare("DROP TRIGGER IF EXISTS log_owner_insert"),
    env.DB.prepare("DROP TRIGGER IF EXISTS log_owner_update"),
    env.DB.prepare("DROP TRIGGER IF EXISTS fail_owner_insert"),
    env.DB.prepare("DROP TRIGGER IF EXISTS fail_owner_update"),
    env.DB.prepare("DROP TABLE IF EXISTS owner_write_log"),
    env.DB.prepare("DELETE FROM settings"),
    env.DB.prepare("DELETE FROM secrets"),
    env.DB.prepare("DELETE FROM meta"),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
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
  access: FIXTURE_INSTALLATION_ACCESS,
};
const APP_ID = 12_345;
/** GitHub's answer to `GET /app` when the request fails: the page then cannot check the app. */
const APP_FAILED: GitHubAnswer = jsonAnswer(500, { message: "Server Error" });
const OWNER_JSON = { id: 583_231, login: "octocat", type: "User" };

/** GitHub's answer to `GET /app` for the app of `USABLE_WORKER_SECRETS` and the saved apps: the full manifest access. */
function appAnswer(changes: Readonly<Record<string, unknown>> = {}): GitHubAnswer {
  return jsonAnswer(
    200,
    appBody({
      id: APP_ID,
      slug: "seluna-demo",
      owner: OWNER_JSON,
      permissions: FULL_PERMISSIONS,
      events: FULL_EVENTS,
      ...changes,
    }),
  );
}
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
    owner: { kind: "hidden" },
    appAccess: { kind: "hidden" },
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
      expected: {
        app: { kind: "saved", appId: 12_345, slug: "seluna-demo" },
        installations: { kind: "unavailable" },
        owner: { kind: "unavailable" },
        appAccess: { kind: "unchecked" },
      },
    },
    {
      case: "a saved app whose slug belongs to another App ID",
      prepare: async () => {
        await seedAppId(SECRET, "12345");
        await putMeta(GITHUB_APP_SLUG_META_KEY, "999:other-app");
      },
      expected: {
        app: { kind: "saved", appId: 12_345, slug: undefined },
        installations: { kind: "unavailable" },
        owner: { kind: "unavailable" },
        appAccess: { kind: "unchecked" },
      },
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
      expected: {
        app: { kind: "worker-secrets" },
        installations: { kind: "key-unusable" },
        owner: { kind: "unavailable" },
        appAccess: { kind: "unchecked" },
      },
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
        owner: { kind: "unavailable" },
        appAccess: { kind: "unchecked" },
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
      app: APP_FAILED,
      installations: jsonAnswer(200, [
        installationEntry({ id: 20, account: { login: "octocat", type: "User" }, repository_selection: "all" }),
        installationEntry({ id: 10, account: { login: "octo-org", type: "Organization" } }),
      ]),
    });

    const installations = await installationsOf(workerEnv, github.fetch);

    expect(installations, "installations").toEqual({
      kind: "listed",
      installations: [
        { installation: { ...OCTOCAT, id: 20, repositorySelection: "all" }, check: { kind: "app-unchecked" } },
        {
          installation: {
            id: 10,
            account: { kind: "login", login: "octo-org", type: "Organization" },
            repositorySelection: "selected",
            suspended: false,
            access: FIXTURE_INSTALLATION_ACCESS,
          },
          check: { kind: "app-unchecked" },
        },
      ],
      more: false,
    });
    expect(
      github.requests.map((request) => request.url),
      "GitHub requests",
    ).toContain("https://api.github.com/app/installations?per_page=100");
  });

  it("statusView signs one JWT and sends GET /app and the installations list", async () => {
    const github = githubApiDouble({ app: appAnswer(), installations: jsonAnswer(200, [installationEntry()]) });

    await installationsOf(USABLE_WORKER_SECRETS, github.fetch);

    expect(github.requests.length, "number of GitHub requests").toBe(2);
    expect(
      github.requests.map((request) => request.route),
      "routes",
    ).toEqual(expect.arrayContaining(["app", "installations"]));
    const bearers = github.requests.map((request) => bearerOf(request.authorization));
    expect(new Set(bearers).size, "number of distinct Bearer tokens").toBe(1);
    const jwt = decodeJwt(bearers[0] ?? "");
    expect(jwt?.claims, "JWT claims").toEqual({
      iat: NOW.getTime() / 1000 - 60,
      exp: NOW.getTime() / 1000 + 540,
      iss: 12_345,
    });
    expect(jwt === undefined ? false : await jwtVerifies(jwt), "JWT signature verifies").toBe(true);
    expect(
      github.requests.map((request) => request.headers.get("user-agent")),
      "User-Agent",
    ).toEqual(["seluna/1.2.3-test", "seluna/1.2.3-test"]);
  });

  it("statusView lists an empty answer as no installations", async () => {
    const github = githubApiDouble({ app: APP_FAILED, installations: jsonAnswer(200, []) });

    const installations = await installationsOf(USABLE_WORKER_SECRETS, github.fetch);

    expect(installations, "installations").toEqual({ kind: "listed", installations: [], more: false });
  });

  it("statusView reports more when the Link header names a next page", async () => {
    const github = githubApiDouble({
      app: APP_FAILED,
      installations: jsonAnswer(200, [installationEntry()], { Link: NEXT_LINK }),
    });

    const installations = await installationsOf(USABLE_WORKER_SECRETS, github.fetch);

    expect(installations, "installations").toEqual({
      kind: "listed",
      installations: [{ installation: OCTOCAT, check: { kind: "app-unchecked" } }],
      more: true,
    });
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
    const github = githubApiDouble({ app: appAnswer(), installations: answer });

    const installations = await installationsOf(USABLE_WORKER_SECRETS, github.fetch);

    expect(installations, "installations").toEqual({ kind: "unavailable" });
    expect(github.requests.length, "number of GitHub requests (the app and the installations)").toBe(2);
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

/** The value of the `github_app_owner` row, or `undefined`. */
async function ownerRow(): Promise<unknown> {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = ?1").bind(GITHUB_APP_OWNER_META_KEY).first();
  return row?.value;
}

/** Counts the statements that try to write the owner row in `owner_write_log`. */
async function logOwnerWrites(): Promise<void> {
  await env.DB.exec("CREATE TABLE owner_write_log (id INTEGER PRIMARY KEY AUTOINCREMENT)");
  await env.DB.prepare(
    "CREATE TRIGGER log_owner_insert BEFORE INSERT ON meta WHEN NEW.key = 'github_app_owner' " +
      "BEGIN INSERT INTO owner_write_log DEFAULT VALUES; END",
  ).run();
  await env.DB.prepare(
    "CREATE TRIGGER log_owner_update BEFORE UPDATE ON meta WHEN NEW.key = 'github_app_owner' " +
      "BEGIN INSERT INTO owner_write_log DEFAULT VALUES; END",
  ).run();
}

async function ownerWriteCount(): Promise<unknown> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM owner_write_log").first();
  return row?.total;
}

/** Makes every write of the owner row fail. */
async function refuseOwnerWrites(): Promise<void> {
  await env.DB.prepare(
    "CREATE TRIGGER fail_owner_insert BEFORE INSERT ON meta WHEN NEW.key = 'github_app_owner' " +
      "BEGIN SELECT RAISE(ABORT, 'owner write refused'); END",
  ).run();
  await env.DB.prepare(
    "CREATE TRIGGER fail_owner_update BEFORE UPDATE ON meta WHEN NEW.key = 'github_app_owner' " +
      "BEGIN SELECT RAISE(ABORT, 'owner write refused'); END",
  ).run();
}

/** The status view of an app from the Worker secrets (App ID 12345, a usable key), asking GitHub through `github`. */
async function viewOfApp(github: GitHubDouble, workerEnv: object = USABLE_WORKER_SECRETS): Promise<StatusView> {
  return statusView({ SELUNA_SECRET: SECRET, ...workerEnv }, env.DB, await keyFor(SECRET), VERSION, {
    fetcher: github.fetch,
    now: () => NOW,
  });
}

/** The checks of the listed installations, in order. */
function checksOf(view: StatusView): readonly unknown[] {
  return view.installations.kind === "listed" ? view.installations.installations.map((entry) => entry.check) : [];
}

const EVERYTHING_BUT_ISSUES_AND_STAR = {
  permissions: Object.fromEntries(Object.entries(FULL_PERMISSIONS).filter(([name]) => name !== "issues")),
  events: FULL_EVENTS.filter((event) => event !== "star"),
};

describe("statusView owner", () => {
  it("statusView stores the owner of GET /app when none is stored", async () => {
    await logOwnerWrites();
    const github = githubApiDouble({ app: appAnswer(), installations: jsonAnswer(200, []) });

    const view = await viewOfApp(github);

    expect(await ownerRow(), "stored owner row").toBe("12345:583231:User:octocat");
    expect(view.owner, "owner line").toEqual({ kind: "known", owner: { id: 583_231, login: "octocat", type: "User" } });
    expect(await ownerWriteCount(), "write statements").toBeGreaterThan(0);
  });

  it("statusView stores the owner of GET /app for a saved app", async () => {
    await saveApp("12345", FIXTURE_PKCS8);
    const github = githubApiDouble({ app: appAnswer(), installations: jsonAnswer(200, []) });

    await viewOfApp(github, {});

    expect(await ownerRow(), "stored owner row").toBe("12345:583231:User:octocat");
  });

  it("statusView writes nothing when the stored owner is the same", async () => {
    await putMeta(GITHUB_APP_OWNER_META_KEY, "12345:583231:User:octocat");
    await logOwnerWrites();
    const github = githubApiDouble({ app: appAnswer(), installations: jsonAnswer(200, []) });

    const view = await viewOfApp(github);

    expect(await ownerWriteCount(), "write statements").toBe(0);
    expect(view.owner, "owner line").toEqual({ kind: "known", owner: { id: 583_231, login: "octocat", type: "User" } });
  });

  it.each([
    { case: "a renamed login", stored: "12345:583231:User:old-login" },
    { case: "another id", stored: "12345:1:User:octocat" },
    { case: "another type", stored: "12345:583231:Organization:octocat" },
  ])("statusView replaces a different owner of the same App ID: $case", async ({ stored }) => {
    await putMeta(GITHUB_APP_OWNER_META_KEY, stored);
    const github = githubApiDouble({ app: appAnswer(), installations: jsonAnswer(200, []) });

    const view = await viewOfApp(github);

    expect(await ownerRow(), "stored owner row").toBe("12345:583231:User:octocat");
    expect(view.owner, "owner line").toEqual({ kind: "known", owner: { id: 583_231, login: "octocat", type: "User" } });
  });

  it("statusView ignores an owner stored for another App ID", async () => {
    await putMeta(GITHUB_APP_OWNER_META_KEY, "999:5:User:other-owner");
    const github = githubApiDouble({ app: appAnswer(), installations: jsonAnswer(200, []) });

    const view = await viewOfApp(github);

    expect(view.owner, "owner line").toEqual({ kind: "known", owner: { id: 583_231, login: "octocat", type: "User" } });
    expect(await ownerRow(), "stored owner row replaced for this App ID").toBe("12345:583231:User:octocat");
  });

  it("statusView answers with GitHub's owner when the owner write fails", async () => {
    await refuseOwnerWrites();
    const github = githubApiDouble({ app: appAnswer(), installations: jsonAnswer(200, []) });

    const view = await viewOfApp(github);

    expect(view.owner, "owner line").toEqual({ kind: "known", owner: { id: 583_231, login: "octocat", type: "User" } });
    expect(await ownerRow(), "stored owner row").toBeUndefined();
  });

  it("statusView answers with GitHub's owner when replacing a stored owner fails", async () => {
    await putMeta(GITHUB_APP_OWNER_META_KEY, "12345:1:User:old-login");
    await refuseOwnerWrites();
    const github = githubApiDouble({ app: appAnswer(), installations: jsonAnswer(200, []) });

    const view = await viewOfApp(github);

    expect(view.owner, "owner line").toEqual({ kind: "known", owner: { id: 583_231, login: "octocat", type: "User" } });
    expect(await ownerRow(), "stored owner row").toBe("12345:1:User:old-login");
  });

  it.each([
    { case: "a type Bot", owner: { id: 1, login: "octocat", type: "Bot" } },
    { case: "an id of 0", owner: { id: 0, login: "octocat", type: "User" } },
    { case: "an id that is a string", owner: { id: "1", login: "octocat", type: "User" } },
    { case: "a login failing the allow-list", owner: { id: 1, login: "octo/cat", type: "User" } },
    { case: "no id", owner: { login: "octocat", type: "User" } },
  ])("statusView stores no owner for an answer whose owner has $case", async ({ owner }) => {
    await logOwnerWrites();
    const github = githubApiDouble({ app: appAnswer({ owner }), installations: jsonAnswer(200, []) });

    await viewOfApp(github);

    expect(await ownerRow(), "stored owner row").toBeUndefined();
    expect(await ownerWriteCount(), "write statements").toBe(0);
  });

  const OLD_OWNER_ROW = "12345:1:User:old-login";
  const OLD_OWNER = { kind: "known", owner: { id: 1, login: "old-login", type: "User" } } as const;
  const NEW_OWNER = { kind: "known", owner: { id: 583_231, login: "octocat", type: "User" } } as const;

  it.each<{ case: string; answer: GitHubAnswer; stored: string | undefined; expected: StatusView["owner"] }>([
    {
      case: "an answer and another stored owner: the answer's",
      answer: appAnswer(),
      stored: OLD_OWNER_ROW,
      expected: NEW_OWNER,
    },
    {
      case: "an answer and no stored owner: the answer's",
      answer: appAnswer(),
      stored: undefined,
      expected: NEW_OWNER,
    },
    {
      case: "an answer for an organization: the organization",
      answer: appAnswer({ owner: { id: 9, login: "octo-org", type: "Organization" } }),
      stored: undefined,
      expected: { kind: "known", owner: { id: 9, login: "octo-org", type: "Organization" } },
    },
    {
      case: "a failed answer and a stored owner: the stored one",
      answer: APP_FAILED,
      stored: OLD_OWNER_ROW,
      expected: OLD_OWNER,
    },
    {
      case: "a failed answer and no stored owner: unavailable",
      answer: APP_FAILED,
      stored: undefined,
      expected: { kind: "unavailable" },
    },
    {
      case: "a failed answer and an owner of another App ID: unavailable",
      answer: APP_FAILED,
      stored: "999:5:User:other-owner",
      expected: { kind: "unavailable" },
    },
    {
      case: "an answer with a malformed owner and a stored owner: the stored one",
      answer: appAnswer({ owner: { id: "x", login: "octocat", type: "User" } }),
      stored: OLD_OWNER_ROW,
      expected: OLD_OWNER,
    },
    {
      case: "an answer with a malformed owner and no stored owner: unavailable",
      answer: appAnswer({ owner: { id: "x", login: "octocat", type: "User" } }),
      stored: undefined,
      expected: { kind: "unavailable" },
    },
    {
      case: "an answer of another App ID and a stored owner: the stored one",
      answer: appAnswer({ id: 999 }),
      stored: OLD_OWNER_ROW,
      expected: OLD_OWNER,
    },
    {
      case: "an answer of another App ID and no stored owner: unavailable",
      answer: appAnswer({ id: 999 }),
      stored: undefined,
      expected: { kind: "unavailable" },
    },
    {
      case: "an unreadable answer and a stored owner: the stored one",
      answer: { kind: "raw", status: 200, body: "not json" },
      stored: OLD_OWNER_ROW,
      expected: OLD_OWNER,
    },
    {
      case: "a rejected request and no stored owner: unavailable",
      answer: REJECTED,
      stored: undefined,
      expected: { kind: "unavailable" },
    },
  ])(
    "statusView shows GitHub's owner, else the stored one, else unavailable: $case",
    async ({ answer, stored, expected }) => {
      if (stored !== undefined) {
        await putMeta(GITHUB_APP_OWNER_META_KEY, stored);
      }
      const github = githubApiDouble({ app: answer, installations: jsonAnswer(200, []) });

      const view = await viewOfApp(github);

      expect(view.owner, "owner line").toEqual(expected);
    },
  );

  it("statusView leaves the stored owner alone when GET /app fails", async () => {
    await putMeta(GITHUB_APP_OWNER_META_KEY, OLD_OWNER_ROW);
    await logOwnerWrites();
    const github = githubApiDouble({ app: APP_FAILED, installations: jsonAnswer(200, []) });

    await viewOfApp(github);

    expect(await ownerRow(), "stored owner row").toBe(OLD_OWNER_ROW);
    expect(await ownerWriteCount(), "write statements").toBe(0);
  });

  it.each<{ case: string; prepare: () => Promise<void>; workerEnv: object }>([
    { case: "no app", prepare: () => Promise.resolve(), workerEnv: {} },
    {
      case: "partial Worker secrets",
      prepare: () => Promise.resolve(),
      workerEnv: { GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: FIXTURE_PEM },
    },
    { case: "an app that cannot be read", prepare: () => seedAppId(OTHER_SECRET, "12345"), workerEnv: {} },
  ])(
    "statusView hides the owner and the app check where the installations line is hidden: $case",
    async ({ prepare, workerEnv }) => {
      await prepare();
      await putMeta(GITHUB_APP_OWNER_META_KEY, OLD_OWNER_ROW);
      const github = githubApiDouble({ app: appAnswer(), installations: jsonAnswer(200, []) });

      const view = await viewOfApp(github, workerEnv);

      expect(view.owner, "owner line").toEqual({ kind: "hidden" });
      expect(view.appAccess, "app check").toEqual({ kind: "hidden" });
      expect(view.installations, "installations").toEqual({ kind: "hidden" });
      expect(github.requests, "GitHub requests").toEqual([]);
    },
  );

  it.each<{
    case: string;
    prepare: () => Promise<void>;
    workerEnv: object;
    stored: string | undefined;
    installations: StatusView["installations"];
    owner: StatusView["owner"];
  }>([
    {
      case: "a saved app without a key and a stored owner",
      prepare: async () => {
        await saveApp("12345", FIXTURE_PKCS8);
        await env.DB.prepare("DELETE FROM secrets WHERE key = 'github_private_key'").run();
      },
      workerEnv: {},
      stored: OLD_OWNER_ROW,
      installations: { kind: "unavailable" },
      owner: OLD_OWNER,
    },
    {
      case: "a saved app with an unusable key and a stored owner",
      prepare: () => saveApp("12345", "private-key-text"),
      workerEnv: {},
      stored: OLD_OWNER_ROW,
      installations: { kind: "key-unusable" },
      owner: OLD_OWNER,
    },
    {
      case: "a saved app with an unusable key and no stored owner",
      prepare: () => saveApp("12345", "private-key-text"),
      workerEnv: {},
      stored: undefined,
      installations: { kind: "key-unusable" },
      owner: { kind: "unavailable" },
    },
    {
      case: "Worker secrets with an unusable key and no stored owner",
      prepare: () => Promise.resolve(),
      workerEnv: WORKER_SECRETS,
      stored: undefined,
      installations: { kind: "key-unusable" },
      owner: { kind: "unavailable" },
    },
    {
      case: "a Worker secret App ID that is no number and no stored owner",
      prepare: () => Promise.resolve(),
      workerEnv: { ...USABLE_WORKER_SECRETS, GITHUB_APP_ID: "0" },
      stored: undefined,
      installations: { kind: "unavailable" },
      owner: { kind: "unavailable" },
    },
  ])(
    "statusView marks the app unchecked without a request: $case",
    async ({ prepare, workerEnv, stored, installations, owner }) => {
      await prepare();
      if (stored !== undefined) {
        await putMeta(GITHUB_APP_OWNER_META_KEY, stored);
      }
      const github = githubApiDouble({});

      const view = await viewOfApp(github, workerEnv);

      expect(view.installations, "installations").toEqual(installations);
      expect(view.appAccess, "app check").toEqual({ kind: "unchecked" });
      expect(view.owner, "owner line").toEqual(owner);
      expect(github.requests, "GitHub requests").toEqual([]);
    },
  );

  it.each([
    { case: "a stored owner", stored: OLD_OWNER_ROW, owner: OLD_OWNER },
    { case: "no stored owner", stored: undefined, owner: { kind: "unavailable" } },
  ] as const)(
    "statusView marks the app unchecked and sends no request when the app JWT cannot be signed: $case",
    async ({ stored, owner }) => {
      await saveApp("12345", FIXTURE_PKCS8);
      if (stored !== undefined) {
        await putMeta(GITHUB_APP_OWNER_META_KEY, stored);
      }
      vi.spyOn(crypto.subtle, "sign").mockRejectedValue(new Error("signing refused"));
      const github = githubApiDouble({ app: appAnswer(), installations: jsonAnswer(200, [installationEntry()]) });

      const view = await viewOfApp(github, {});

      expect(view.installations, "installations").toEqual({ kind: "unavailable" });
      expect(view.appAccess, "app check").toEqual({ kind: "unchecked" });
      expect(view.owner, "owner line").toEqual(owner);
      expect(github.requests, "GitHub requests").toEqual([]);
      expect(await ownerRow(), "stored owner row").toBe(stored);
    },
  );
});

describe("statusView app access", () => {
  it("statusView reports what the app lacks with the settings link", async () => {
    const github = githubApiDouble({
      app: appAnswer({
        permissions: EVERYTHING_BUT_ISSUES_AND_STAR.permissions,
        events: EVERYTHING_BUT_ISSUES_AND_STAR.events,
      }),
      installations: jsonAnswer(200, []),
    });

    const view = await viewOfApp(github);

    expect(view.appAccess, "app check").toEqual({
      kind: "checked",
      missing: { permissions: ["issues"], events: ["star"] },
      settingsUrl: "https://github.com/settings/apps/seluna-demo/permissions",
    });
  });

  it("statusView links the organization's settings page for an organization's app", async () => {
    const github = githubApiDouble({
      app: appAnswer({
        owner: { id: 9, login: "octo-org", type: "Organization" },
        permissions: { metadata: "read" },
        events: [],
      }),
      installations: jsonAnswer(200, []),
    });

    const view = await viewOfApp(github);

    expect(view.appAccess.kind, "app check").toBe("checked");
    expect(view.appAccess.kind === "checked" ? view.appAccess.settingsUrl : undefined, "settings link").toBe(
      "https://github.com/organizations/octo-org/settings/apps/seluna-demo/permissions",
    );
    expect(view.appAccess.kind === "checked" ? view.appAccess.missing.permissions : [], "missing permissions").toEqual([
      "actions",
      "contents",
      "issues",
      "pull_requests",
      "vulnerability_alerts",
      "security_events",
      "secret_scanning_alerts",
    ]);
  });

  it("statusView reports what an installation lacks of what the app has", async () => {
    const github = githubApiDouble({
      app: appAnswer(),
      installations: jsonAnswer(200, [
        installationWithAccess(EVERYTHING_BUT_ISSUES_AND_STAR.permissions, EVERYTHING_BUT_ISSUES_AND_STAR.events, {
          id: 1,
        }),
        installationWithAccess({ ...FULL_PERMISSIONS, contents: "write" }, [...FULL_EVENTS, "push"], {
          id: 2,
          account: { login: "octo-org", type: "Organization" },
        }),
        installationWithAccess({ metadata: "read" }, [], {
          id: 3,
          account: { login: "octo-org", type: "Organization" },
        }),
      ]),
    });

    const view = await viewOfApp(github);

    expect(checksOf(view), "checks").toEqual([
      {
        kind: "missing",
        missing: { permissions: ["issues"], events: ["star"] },
        acceptUrl: "https://github.com/settings/installations/1",
      },
      { kind: "complete" },
      {
        kind: "missing",
        missing: {
          permissions: [
            "actions",
            "contents",
            "issues",
            "pull_requests",
            "vulnerability_alerts",
            "security_events",
            "secret_scanning_alerts",
          ],
          events: FULL_EVENTS,
        },
        acceptUrl: "https://github.com/organizations/octo-org/settings/installations/3",
      },
    ]);
    expect(view.appAccess.kind === "checked" ? view.appAccess.missing : undefined, "app lacks nothing").toEqual({
      permissions: [],
      events: [],
    });
  });

  it("statusView names something the app lacks only on the app", async () => {
    const github = githubApiDouble({
      app: appAnswer({
        permissions: EVERYTHING_BUT_ISSUES_AND_STAR.permissions,
        events: EVERYTHING_BUT_ISSUES_AND_STAR.events,
      }),
      installations: jsonAnswer(200, [
        installationWithAccess(EVERYTHING_BUT_ISSUES_AND_STAR.permissions, EVERYTHING_BUT_ISSUES_AND_STAR.events),
      ]),
    });

    const view = await viewOfApp(github);

    expect(view.appAccess.kind === "checked" ? view.appAccess.missing : undefined, "app check").toEqual({
      permissions: ["issues"],
      events: ["star"],
    });
    expect(checksOf(view), "installation checks").toEqual([{ kind: "complete" }]);
  });

  it("statusView reports nothing missing for a complete app and installations", async () => {
    const github = githubApiDouble({
      app: appAnswer(),
      installations: jsonAnswer(200, [
        installationWithAccess(FULL_PERMISSIONS, FULL_EVENTS, { id: 1 }),
        installationWithAccess(FULL_PERMISSIONS, FULL_EVENTS, { id: 2 }),
      ]),
    });

    const view = await viewOfApp(github);

    expect(view.appAccess.kind, "app check").toBe("checked");
    expect(view.appAccess.kind === "checked" ? view.appAccess.missing : undefined, "app lacks").toEqual({
      permissions: [],
      events: [],
    });
    expect(checksOf(view), "installation checks").toEqual([{ kind: "complete" }, { kind: "complete" }]);
  });

  it("statusView checks a suspended installation", async () => {
    const github = githubApiDouble({
      app: appAnswer(),
      installations: jsonAnswer(200, [
        installationWithAccess({ metadata: "read" }, [], { suspended_at: "2026-01-02T03:04:05Z" }),
      ]),
    });

    const view = await viewOfApp(github);

    expect(checksOf(view)[0], "check of the suspended installation").toMatchObject({ kind: "missing" });
  });

  it("statusView gives no link for an installation of an enterprise account but still names what is missing", async () => {
    const github = githubApiDouble({
      app: appAnswer(),
      installations: jsonAnswer(200, [installationWithAccess({ metadata: "read" }, [], { account: { slug: "acme" } })]),
    });

    const view = await viewOfApp(github);

    expect(checksOf(view)[0], "check").toMatchObject({ kind: "missing", acceptUrl: undefined });
  });

  it("statusView marks the app unchecked and installations without a suffix when GET /app fails", async () => {
    const github = githubApiDouble({
      app: APP_FAILED,
      installations: jsonAnswer(200, [installationWithAccess({ metadata: "read" }, []), installationEntry({ id: 2 })]),
    });

    const view = await viewOfApp(github);

    expect(view.appAccess, "app check").toEqual({ kind: "unchecked" });
    expect(checksOf(view), "installation checks").toEqual([{ kind: "app-unchecked" }, { kind: "app-unchecked" }]);
    expect(view.installations.kind, "installations").toBe("listed");
  });

  it("statusView treats a GET /app answer of another App ID as failed", async () => {
    const github = githubApiDouble({
      app: appAnswer({ id: 999, permissions: { metadata: "read" }, events: [] }),
      installations: jsonAnswer(200, [installationWithAccess({ metadata: "read" }, [])]),
    });

    const view = await viewOfApp(github);

    expect(view.appAccess, "app check").toEqual({ kind: "unchecked" });
    expect(checksOf(view), "installation checks").toEqual([{ kind: "app-unchecked" }]);
  });

  it("statusView treats a GET /app answer of unusable access as failed", async () => {
    const github = githubApiDouble({
      app: appAnswer({ events: "push" }),
      installations: jsonAnswer(200, [installationEntry()]),
    });

    const view = await viewOfApp(github);

    expect(view.appAccess, "app check").toEqual({ kind: "unchecked" });
    expect(checksOf(view), "installation checks").toEqual([{ kind: "app-unchecked" }]);
  });

  it.each([
    { case: "missing permissions", permissions: undefined, events: ["issues"] },
    { case: "permissions that are an array", permissions: ["metadata"], events: ["issues"] },
    { case: "missing events", permissions: FULL_PERMISSIONS, events: undefined },
    { case: "an event that is not a string", permissions: FULL_PERMISSIONS, events: ["issues", 1] },
  ])(
    "statusView marks an installation with unreadable access as not checked: $case",
    async ({ permissions, events }) => {
      const github = githubApiDouble({
        app: appAnswer(),
        installations: jsonAnswer(200, [
          installationWithAccess(FULL_PERMISSIONS, FULL_EVENTS, { id: 1 }),
          installationWithAccess(permissions, events, { id: 2 }),
        ]),
      });

      const view = await viewOfApp(github);

      expect(checksOf(view), "installation checks").toEqual([{ kind: "complete" }, { kind: "unreadable" }]);
    },
  );

  it("statusView takes the slug from the answer", async () => {
    await saveApp("12345", FIXTURE_PKCS8);
    await putMeta(GITHUB_APP_SLUG_META_KEY, "12345:stored-slug");
    const github = githubApiDouble({
      app: appAnswer({ slug: "answer-slug", permissions: { metadata: "read" }, events: [] }),
      installations: jsonAnswer(200, []),
    });

    const view = await viewOfApp(github, {});

    expect(view.appAccess.kind === "checked" ? view.appAccess.settingsUrl : undefined, "settings link").toBe(
      "https://github.com/settings/apps/answer-slug/permissions",
    );
  });

  it.each([
    { case: "an answer without a slug", slug: undefined },
    { case: "an answer whose slug fails the allow-list", slug: "Bad_Slug" },
  ])("statusView takes the stored slug for $case", async ({ slug }) => {
    await saveApp("12345", FIXTURE_PKCS8);
    await putMeta(GITHUB_APP_SLUG_META_KEY, "12345:stored-slug");
    const github = githubApiDouble({
      app: appAnswer({ slug, permissions: { metadata: "read" }, events: [] }),
      installations: jsonAnswer(200, []),
    });

    const view = await viewOfApp(github, {});

    expect(view.appAccess.kind === "checked" ? view.appAccess.settingsUrl : undefined, "settings link").toBe(
      "https://github.com/settings/apps/stored-slug/permissions",
    );
  });

  it("statusView builds no settings link without a slug but still names what the app lacks", async () => {
    const github = githubApiDouble({
      app: appAnswer({ slug: undefined, permissions: { metadata: "read" }, events: [] }),
      installations: jsonAnswer(200, []),
    });

    const view = await viewOfApp(github);

    expect(view.appAccess, "app check").toMatchObject({ kind: "checked", settingsUrl: undefined });
    expect(
      view.appAccess.kind === "checked" ? view.appAccess.missing.permissions.length : 0,
      "missing permissions",
    ).toBe(7);
  });

  it("statusView builds no settings link for a stored slug of another App ID", async () => {
    await putMeta(GITHUB_APP_SLUG_META_KEY, "999:other-slug");
    const github = githubApiDouble({
      app: appAnswer({ slug: undefined, permissions: { metadata: "read" }, events: [] }),
      installations: jsonAnswer(200, []),
    });

    const view = await viewOfApp(github);

    expect(view.appAccess, "app check").toMatchObject({ kind: "checked", settingsUrl: undefined });
  });

  it("statusView still answers when the installations list fails but the app is read", async () => {
    const github = githubApiDouble({ app: appAnswer(), installations: jsonAnswer(500, { message: "Server Error" }) });

    const view = await viewOfApp(github);

    expect(view.installations, "installations").toEqual({ kind: "unavailable" });
    expect(view.appAccess.kind, "app check").toBe("checked");
    expect(view.owner.kind, "owner line").toBe("known");
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
