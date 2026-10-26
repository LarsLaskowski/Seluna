import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { DeliveryLogEntry } from "./delivery";
import { renderTelegramText } from "./message";
import { checkForRelease, formatReleaseMessage, releaseNotification } from "./release-check";
import type { ReleaseCheckDeps, ReleaseCheckResult } from "./release-check";
import { DEFAULT_SETTINGS } from "./settings";
import { NOTIFIED_RELEASE_META_KEY } from "./store/notified-release";
import { DELIVERY_CHANNEL_SETTING, writeNotificationSettings, writeSetting } from "./store/settings";
import { TELEGRAM_CHANNEL } from "./channels/telegram";
import { testChannel } from "../test/channel";
import { applyMigrations } from "../test/d1";
import { FIXTURES as GITHUB_FIXTURES, githubApiDouble, jsonAnswer as githubAnswer, REJECTED } from "../test/github";
import type { GitHubRouteAnswer } from "../test/github";
import { FIXTURES, jsonAnswer, telegramDouble } from "../test/telegram";

const TOKEN = "123456789:AAH-throwaway_token0123456789abcdefghij";
const CHAT = 5_001_001;
const READY_ENV = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: String(CHAT) };
const STARTED_AT = new Date("2026-10-21T05:17:00Z");
const RELEASE_URL = "https://github.com/LarsLaskowski/Seluna/releases/tag/v0.5.0";
const ENGLISH_TEXT =
  "<b>New Seluna release</b> · LarsLaskowski/Seluna\nVersion 0.5.0 is available; this instance runs 0.4.0.";
const GERMAN_TEXT =
  "<b>Neue Seluna-Version</b> · LarsLaskowski/Seluna\nVersion 0.5.0 ist verfügbar; diese Instanz läuft mit 0.4.0.";
const ENGLISH_STORED =
  '{"title":"New Seluna release","repository":"LarsLaskowski/Seluna","number":null,"subject":"Version 0.5.0 is available; this instance runs 0.4.0.","context":""}';
const GERMAN_STORED =
  '{"title":"Neue Seluna-Version","repository":"LarsLaskowski/Seluna","number":null,"subject":"Version 0.5.0 ist verfügbar; diese Instanz läuft mit 0.4.0.","context":""}';
const ACCEPTED = jsonAnswer(200, FIXTURES.sendMessage);

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM outbox"),
    env.DB.prepare("DELETE FROM settings"),
    env.DB.prepare("DELETE FROM meta"),
  ]);
});

/** The captured answer with `tag_name` replaced. */
function releaseWithTag(tag: unknown): unknown {
  return { ...(GITHUB_FIXTURES.latestRelease as Record<string, unknown>), tag_name: tag };
}

function latestAnswer(tag: string): GitHubRouteAnswer {
  return githubAnswer(200, releaseWithTag(tag));
}

/** A database that passes everything to `env.DB` except a statement matching `failing` (`prepare` throws), or the batch when `failBatch`. */
function dbFailingFor(failing: RegExp | undefined, failBatch = false): D1Database {
  const unsupported = (): never => {
    throw new Error("Not supported by this wrapper");
  };
  return {
    prepare: (query: string) => {
      if (failing?.test(query) === true) {
        throw new Error("The database failed");
      }
      return env.DB.prepare(query);
    },
    batch: (statements) => (failBatch ? Promise.reject(new Error("The database failed")) : env.DB.batch(statements)),
    exec: unsupported,
    dump: unsupported,
    withSession: unsupported,
  };
}

interface Harness {
  readonly deps: ReleaseCheckDeps;
  readonly log: DeliveryLogEntry[];
  readonly telegram: ReturnType<typeof telegramDouble>;
  readonly github: ReturnType<typeof githubApiDouble>;
}

interface HarnessOptions {
  readonly latest?: GitHubRouteAnswer;
  readonly version?: string;
  readonly checkEnv?: object;
  readonly db?: D1Database;
}

function harness(options: HarnessOptions = {}): Harness {
  const { latest = latestAnswer("v0.5.0"), version = "0.4.0", checkEnv = READY_ENV, db = env.DB } = options;
  const telegram = telegramDouble({ sendMessage: ACCEPTED });
  const github = githubApiDouble({ latestRelease: latest });
  const log: DeliveryLogEntry[] = [];
  const deps: ReleaseCheckDeps = {
    env: checkEnv,
    db,
    fetch: telegram.fetch,
    githubFetch: github.fetch,
    sleep: () => Promise.resolve(),
    log: (entry) => {
      log.push(entry);
    },
    now: () => STARTED_AT,
    version,
  };
  return { deps, log, telegram, github };
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

describe("releaseNotification", () => {
  it.each([
    {
      language: "en" as const,
      title: "New Seluna release",
      subject: "Version 0.5.0 is available; this instance runs 0.4.0.",
    },
    {
      language: "de" as const,
      title: "Neue Seluna-Version",
      subject: "Version 0.5.0 ist verfügbar; diese Instanz läuft mit 0.4.0.",
    },
  ])("releaseNotification returns the neutral $language notice and the tag URL", ({ language, title, subject }) => {
    const notice = releaseNotification({ major: 0, minor: 5, patch: 0 }, { major: 0, minor: 4, patch: 0 }, language);

    expect(notice, "notice").toEqual({
      notification: { title, repository: "LarsLaskowski/Seluna", number: undefined, subject, context: "" },
      buttonUrl: RELEASE_URL,
    });
  });
});

describe("formatReleaseMessage (AC6)", () => {
  it.each([{ language: "en" as const }, { language: "de" as const }])(
    "formatReleaseMessage equals renderTelegramText of releaseNotification in $language",
    ({ language }) => {
      const latest = { major: 0, minor: 5, patch: 0 };
      const running = { major: 0, minor: 4, patch: 0 };

      const message = formatReleaseMessage(latest, running, language);

      const notice = releaseNotification(latest, running, language);
      expect(message.text, "text").toBe(renderTelegramText(notice.notification));
      expect(message.buttonUrl, "button URL").toBe(notice.buttonUrl);
    },
  );

  it.each([
    { language: "en" as const, text: ENGLISH_TEXT },
    { language: "de" as const, text: GERMAN_TEXT },
  ])("formatReleaseMessage writes the exact $language text and the tag URL", ({ language, text }) => {
    const message = formatReleaseMessage({ major: 0, minor: 5, patch: 0 }, { major: 0, minor: 4, patch: 0 }, language);

    expect(message, "message").toEqual({ text, buttonUrl: RELEASE_URL });
  });

  it("formatReleaseMessage writes every part as a decimal number and the URL from the same numbers", () => {
    const message = formatReleaseMessage(
      { major: 999_999_999, minor: 10, patch: 0 },
      { major: 1, minor: 0, patch: 99 },
      "en",
    );

    expect(message, "message").toEqual({
      text: "<b>New Seluna release</b> · LarsLaskowski/Seluna\nVersion 999999999.10.0 is available; this instance runs 1.0.99.",
      buttonUrl: "https://github.com/LarsLaskowski/Seluna/releases/tag/v999999999.10.0",
    });
  });
});

describe("checkForRelease (AC6: reporting)", () => {
  it("checkForRelease reports v0.5.0 over 0.4.0 with one row, the remembered version and one message", async () => {
    const { deps, github, log, telegram } = harness();

    const result = await checkForRelease(STARTED_AT, deps);

    expect(result, "result").toBe("reported");
    expect(github.requests.length, "number of GitHub requests").toBe(1);
    expect(github.requests[0]?.authorization, "Authorization header").toBeNull();
    expect(await remembered(), "remembered version").toBe("0.5.0");
    expect(await outboxRows(), "outbox rows").toMatchObject([
      {
        text: ENGLISH_STORED,
        button_url: RELEASE_URL,
        silent: 0,
        status: "sent",
        attempts: 1,
        created_at: STARTED_AT.getTime(),
      },
    ]);
    expect(telegram.requests.length, "number of Telegram requests").toBe(1);
    expect(telegram.requests[0]?.body, "request body").toMatchObject({
      chat_id: CHAT,
      text: ENGLISH_TEXT,
      reply_markup: { inline_keyboard: [[{ text: "Open on GitHub", url: RELEASE_URL }]] },
    });
    expect(log, "log entries").toHaveLength(1);
    expect(log[0], "log entry").toMatchObject({ result: "sent" });
  });

  it("checkForRelease writes the text in the notification language", async () => {
    await writeNotificationSettings(env.DB, { ...DEFAULT_SETTINGS, language: "de" });
    const { deps } = harness();

    const result = await checkForRelease(STARTED_AT, deps);

    expect(result, "result").toBe("reported");
    expect(await outboxRows(), "outbox rows").toMatchObject([{ text: GERMAN_STORED, button_url: RELEASE_URL }]);
  });

  it("checkForRelease answers known and sends nothing on the second run", async () => {
    const first = harness();
    await checkForRelease(STARTED_AT, first.deps);
    const second = harness();

    const result = await checkForRelease(STARTED_AT, second.deps);

    expect(result, "result").toBe("known");
    expect(second.telegram.requests.length, "number of Telegram requests").toBe(0);
    expect(await outboxRows(), "number of rows").toHaveLength(1);
    expect(await remembered(), "remembered version").toBe("0.5.0");
  });

  it("checkForRelease reports v0.6.0 after 0.5.0 was reported", async () => {
    await putRemembered("0.5.0");
    const { deps, telegram } = harness({ latest: latestAnswer("v0.6.0") });

    const result = await checkForRelease(STARTED_AT, deps);

    expect(result, "result").toBe("reported");
    expect(await remembered(), "remembered version").toBe("0.6.0");
    expect(telegram.requests.length, "number of Telegram requests").toBe(1);
    expect(await outboxRows(), "outbox rows").toMatchObject([
      {
        text: '{"title":"New Seluna release","repository":"LarsLaskowski/Seluna","number":null,"subject":"Version 0.6.0 is available; this instance runs 0.4.0.","context":""}',
      },
    ]);
  });

  it("checkForRelease keeps a remembered 0.6.0 and answers known for a latest v0.5.0", async () => {
    await putRemembered("0.6.0");
    const { deps, telegram } = harness();

    const result = await checkForRelease(STARTED_AT, deps);

    expect(result, "result").toBe("known");
    expect(await remembered(), "remembered version").toBe("0.6.0");
    expect(await outboxRows(), "outbox rows").toEqual([]);
    expect(telegram.requests.length, "number of Telegram requests").toBe(0);
  });

  it("checkForRelease writes the row and the version and leaves the row pending without a chat", async () => {
    const { deps, log, telegram } = harness({ checkEnv: { TELEGRAM_BOT_TOKEN: TOKEN } });

    const result = await checkForRelease(STARTED_AT, deps);

    expect(result, "result").toBe("reported");
    expect(await remembered(), "remembered version").toBe("0.5.0");
    expect(await outboxRows(), "outbox rows").toMatchObject([{ status: "pending", attempts: 0 }]);
    expect(telegram.requests.length, "number of Telegram requests").toBe(0);
    expect(log, "log entries").toMatchObject([{ result: "no-chat" }]);
  });

  it("checkForRelease sends to the chat chosen in the setup", async () => {
    await writeSetting(env.DB, "telegram_chat_id", String(CHAT));
    const { deps, telegram } = harness({ checkEnv: { TELEGRAM_BOT_TOKEN: TOKEN } });

    const result = await checkForRelease(STARTED_AT, deps);

    expect(result, "result").toBe("reported");
    expect(telegram.requests[0]?.body, "request body").toMatchObject({ chat_id: CHAT });
  });
});

describe("checkForRelease (AC9: the remembered value)", () => {
  it("checkForRelease reports v0.5.0 when the remembered value is garbage and replaces it", async () => {
    await putRemembered("garbage");
    const { deps, telegram } = harness();

    const result = await checkForRelease(STARTED_AT, deps);

    expect(result, "result").toBe("reported");
    expect(await remembered(), "remembered version").toBe("0.5.0");
    expect(telegram.requests.length, "number of Telegram requests").toBe(1);
  });

  it("checkForRelease reports a latest release newer than a remembered 0.9.0 by comparing numbers", async () => {
    await putRemembered("0.9.0");
    const { deps } = harness({ latest: latestAnswer("v0.10.0") });

    const result = await checkForRelease(STARTED_AT, deps);

    expect(result, "result").toBe("reported");
    expect(await remembered(), "remembered version").toBe("0.10.0");
  });
});

describe("checkForRelease (AC7: nothing newer, switch off)", () => {
  it.each([
    { case: "equal to", tag: "v0.4.0" },
    { case: "older than", tag: "v0.3.9" },
  ])(
    "checkForRelease answers current and writes nothing when the latest is $case the running version",
    async ({ tag }) => {
      const { deps, telegram } = harness({ latest: latestAnswer(tag) });

      const result = await checkForRelease(STARTED_AT, deps);

      expect(result, "result").toBe("current");
      expect(await outboxRows(), "outbox rows").toEqual([]);
      expect(await remembered(), "remembered version").toBeUndefined();
      expect(telegram.requests.length, "number of Telegram requests").toBe(0);
    },
  );

  it("checkForRelease answers off without a GitHub request and without reading meta when the update notice is off", async () => {
    await writeNotificationSettings(env.DB, { ...DEFAULT_SETTINGS, updateNotice: false });
    const { deps, github, telegram } = harness({ db: dbFailingFor(/FROM meta/) });

    const result = await checkForRelease(STARTED_AT, deps);

    expect(result, "result").toBe("off");
    expect(github.requests.length, "number of GitHub requests").toBe(0);
    expect(telegram.requests.length, "number of Telegram requests").toBe(0);
    expect(await outboxRows(), "outbox rows").toEqual([]);
  });
});

describe("checkForRelease (AC8: failures)", () => {
  it.each(["0.4", "", "v0.4.0", "0.4.0-rc.1", "01.4.0", "1000000000.0.0"])(
    "checkForRelease answers invalid-version without a request for the running version %j",
    async (version) => {
      const { deps, github } = harness({ version });

      const result = await checkForRelease(STARTED_AT, deps);

      expect(result, "result").toBe("invalid-version");
      expect(github.requests.length, "number of GitHub requests").toBe(0);
      expect(await outboxRows(), "outbox rows").toEqual([]);
      expect(await remembered(), "remembered version").toBeUndefined();
    },
  );

  it.each<{ case: string; latest: GitHubRouteAnswer; result: ReleaseCheckResult }>([
    { case: "404", latest: githubAnswer(404, { message: "Not Found" }), result: "no-release" },
    { case: "403", latest: githubAnswer(403, { message: "rate limit" }), result: "refused" },
    {
      case: "302",
      latest: { kind: "raw", status: 302, body: null, headers: { location: "https://x.test/" } },
      result: "refused",
    },
    { case: "a rejected request", latest: REJECTED, result: "unavailable" },
    { case: "an answer that is not JSON", latest: { kind: "raw", status: 200, body: "<html>" }, result: "unavailable" },
    { case: "an empty object", latest: githubAnswer(200, {}), result: "malformed" },
    { case: "a tag with a line feed", latest: latestAnswer("v0.5.0\n"), result: "malformed" },
  ])("checkForRelease answers $result and writes nothing for $case", async ({ latest, result }) => {
    const { deps, telegram } = harness({ latest });

    const outcome = await checkForRelease(STARTED_AT, deps);

    expect(outcome, "result").toBe(result);
    expect(await outboxRows(), "outbox rows").toEqual([]);
    expect(await remembered(), "remembered version").toBeUndefined();
    expect(telegram.requests.length, "number of Telegram requests").toBe(0);
  });

  it("checkForRelease keeps a malformed tag from the message and the version", async () => {
    const tag = "v0.5.0\u202e";
    const { deps } = harness({ latest: latestAnswer(tag) });

    const result = await checkForRelease(STARTED_AT, deps);

    expect(tag.includes("\u202e"), "the input holds U+202E").toBe(true);
    expect(result, "result").toBe("malformed");
    expect(await outboxRows(), "outbox rows").toEqual([]);
  });

  it("checkForRelease answers store-failed and requests nothing when reading the settings fails", async () => {
    const { deps, github, telegram } = harness({ db: dbFailingFor(/FROM settings/) });

    const result = await checkForRelease(STARTED_AT, deps);

    expect(result, "result").toBe("store-failed");
    expect(github.requests.length, "number of GitHub requests").toBe(0);
    expect(telegram.requests.length, "number of Telegram requests").toBe(0);
    expect(await outboxRows(), "outbox rows").toEqual([]);
    expect(await remembered(), "remembered version").toBeUndefined();
  });

  it("checkForRelease answers store-failed and requests nothing when reading the remembered version fails", async () => {
    const { deps, github, telegram } = harness({ db: dbFailingFor(/FROM meta/) });

    const result = await checkForRelease(STARTED_AT, deps);

    expect(result, "result").toBe("store-failed");
    expect(github.requests.length, "number of GitHub requests").toBe(0);
    expect(telegram.requests.length, "number of Telegram requests").toBe(0);
    expect(await outboxRows(), "outbox rows").toEqual([]);
  });

  it("checkForRelease answers store-failed and writes and sends nothing when the batch fails", async () => {
    const { deps, github, telegram } = harness({ db: dbFailingFor(undefined, true) });

    const result = await checkForRelease(STARTED_AT, deps);

    expect(result, "result").toBe("store-failed");
    expect(github.requests.length, "number of GitHub requests").toBe(1);
    expect(telegram.requests.length, "number of Telegram requests").toBe(0);
    expect(await outboxRows(), "outbox rows").toEqual([]);
    expect(await remembered(), "remembered version").toBeUndefined();
  });
});

describe("checkForRelease through the active channel", () => {
  it.each([
    { language: "en" as const, label: "Open on GitHub", stored: ENGLISH_STORED },
    { language: "de" as const, label: "Auf GitHub öffnen", stored: GERMAN_STORED },
  ])(
    "checkForRelease sends the notice through the active test channel in $language and not through Telegram",
    async ({ language, label, stored }) => {
      await writeNotificationSettings(env.DB, { ...DEFAULT_SETTINGS, language });
      await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");
      const channel = testChannel();
      const { deps, log, telegram } = harness();

      const result = await checkForRelease(STARTED_AT, { ...deps, channels: [TELEGRAM_CHANNEL, channel] });

      expect(result, "result").toBe("reported");
      expect(telegram.requests.length, "Telegram requests").toBe(0);
      expect(channel.sends.length, "sends through the test channel").toBe(1);
      expect(channel.sends[0]?.message, "message").toEqual({
        content: {
          kind: "notification",
          notification: releaseNotification(
            { major: 0, minor: 5, patch: 0 },
            { major: 0, minor: 4, patch: 0 },
            language,
          ).notification,
        },
        buttonUrl: RELEASE_URL,
      });
      expect(channel.sends[0]?.options.silent, "silent").toBe(false);
      expect(channel.sends[0]?.options.buttonLabel, "button label").toBe(label);
      expect(await outboxRows(), "outbox rows").toMatchObject([{ text: stored, status: "sent", attempts: 1 }]);
      expect(log, "log entries").toHaveLength(1);
      expect(log[0], "log entry").toMatchObject({ result: "sent" });
    },
  );

  it("checkForRelease keeps the row pending with attempts 0 and calls no channel while the active test channel is not ready", async () => {
    await writeSetting(env.DB, DELIVERY_CHANNEL_SETTING, "test");
    const channel = testChannel({ configured: false });
    const { deps, log, telegram } = harness();

    const result = await checkForRelease(STARTED_AT, { ...deps, channels: [TELEGRAM_CHANNEL, channel] });

    expect(result, "result").toBe("reported");
    expect(telegram.requests.length, "Telegram requests: no fallback").toBe(0);
    expect(channel.sends.length, "sends").toBe(0);
    expect(await outboxRows(), "outbox rows").toMatchObject([{ status: "pending", attempts: 0 }]);
    expect(log[0], "log entry").toMatchObject({ result: "no-token" });
  });
});
