import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelMessage, ChannelSendDeps, ChannelTarget, SendOptions } from "./channel";
import { TELEGRAM_CHANNEL } from "./telegram";
import { formatMessage } from "../message";
import { storedNotificationOf } from "../notification";
import type { Notification } from "../rules/rule";
import { TELEGRAM_CHAT_ID_SETTING, writeSetting } from "../store/settings";
import { sendNotification } from "../telegram";
import { applyMigrations } from "../../test/d1";
import { FIXTURES, jsonAnswer, REJECTED, telegramDouble } from "../../test/telegram";
import type { TelegramAnswer } from "../../test/telegram";

const TOKEN = "123456789:AAH-throwaway_token0123456789abcdefghij";
const CHAT = 5_001_001;
const READY_ENV = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: String(CHAT) };

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([env.DB.prepare("DELETE FROM settings"), env.DB.prepare("DELETE FROM secrets")]);
});

/** One notification per rule, as the rules build them, with markup characters where a title can carry them. */
const RULE_NOTIFICATIONS: readonly { readonly rule: string; readonly notification: Notification }[] = [
  {
    rule: "pull request",
    notification: {
      title: "New pull request",
      repository: "example-owner/example-other-repo",
      number: 143,
      subject: "[Docs] Update <the> contributor & documentation",
      context: "by example-owner · claude/example-branch → main",
      url: "https://github.com/example-owner/example-other-repo/pull/143",
    },
  },
  {
    rule: "CI failure",
    notification: {
      title: "CI failed on a<b>&c",
      repository: "example-owner/example-repo",
      number: undefined,
      subject: "Fix the build",
      context: "a<b>&c · <i>&amp;",
      url: "https://github.com/example-owner/example-repo/actions/runs/1",
    },
  },
  {
    rule: "Dependabot",
    notification: {
      title: "Dependabot alert",
      repository: "example-owner/example-repo",
      number: 1,
      subject: "Insertion of Sensitive Information into Log File in ansible",
      context: "medium · ansible",
      url: "https://github.com/example-owner/example-repo/security/dependabot/1",
    },
  },
  {
    rule: "code scanning",
    notification: {
      title: "Code scanning alert",
      repository: "example-owner/example-repo",
      number: 42,
      subject: 'Arbitrary file write during zip extraction ("Zip Slip")',
      context: "error · js/zipslip",
      url: "https://github.com/example-owner/example-repo/code-scanning/42",
    },
  },
  {
    rule: "secret scanning",
    notification: {
      title: "Secret scanning alert",
      repository: "example-owner/example-repo",
      number: 42,
      subject: "Mailchimp API Key",
      context: "",
      url: "https://github.com/example-owner/example-repo/security/secret-scanning/42",
    },
  },
];

const NOTHING_TO_WAIT_FOR = (): Promise<void> => Promise.resolve();

/** The target of `prepare` for `deliveryEnv`, which must be ready. */
async function readySend(deliveryEnv: object = READY_ENV): Promise<Extract<ChannelTarget, { kind: "ready" }>["send"]> {
  const target = await TELEGRAM_CHANNEL.prepare(deliveryEnv, env.DB);
  if (target.kind !== "ready") {
    throw new TypeError("The Telegram channel is not ready");
  }
  return target.send;
}

/** The requests of `double` without their abort signals, which differ per request. */
function withoutSignal(double: ReturnType<typeof telegramDouble>): readonly object[] {
  return double.requests.map(({ method, token, origin, httpMethod, contentType, body }) => ({
    method,
    token,
    origin,
    httpMethod,
    contentType,
    body,
  }));
}

function optionsOf(overrides: Partial<SendOptions> = {}): SendOptions {
  return { silent: false, buttonLabel: "Open on GitHub", outboxId: 1, ...overrides };
}

function depsOf(
  telegram: ReturnType<typeof telegramDouble>,
  sleep: ChannelSendDeps["sleep"] = NOTHING_TO_WAIT_FOR,
): ChannelSendDeps {
  return { fetch: telegram.fetch, sleep };
}

describe("TELEGRAM_CHANNEL send", () => {
  it.each(
    RULE_NOTIFICATIONS.flatMap(({ rule, notification }) =>
      [false, true].flatMap((silent) =>
        [
          { language: "en", label: "Open on GitHub" },
          { language: "de", label: "Auf GitHub öffnen" },
        ].map(({ language, label }) => ({ rule, notification, silent, language, label })),
      ),
    ),
  )(
    "TELEGRAM_CHANNEL send posts the same sendMessage body for a stored $rule notification as sendNotification did for formatMessage of it (silent $silent, $language)",
    async ({ notification, silent, label }) => {
      const before = telegramDouble();
      const formatted = formatMessage(notification);
      await sendNotification(
        TOKEN,
        CHAT,
        { text: formatted.text, buttonText: label, buttonUrl: formatted.buttonUrl, silent },
        before.fetch,
        NOTHING_TO_WAIT_FOR,
      );
      const after = telegramDouble();
      const send = await readySend();
      const message: ChannelMessage = {
        content: { kind: "notification", notification: storedNotificationOf(notification) },
        buttonUrl: formatted.buttonUrl,
      };

      const result = await send(message, optionsOf({ silent, buttonLabel: label }), depsOf(after));

      expect(result, "result").toBe("sent");
      expect(withoutSignal(after), "the request equals the one sent before the change").toEqual(withoutSignal(before));
    },
  );

  it("TELEGRAM_CHANNEL send posts the exact sendMessage request for a stored notification", async () => {
    const telegram = telegramDouble();
    const send = await readySend();

    await send(
      {
        content: {
          kind: "notification",
          notification: { title: "T <b>", repository: "o/r", number: 7, subject: "S & S", context: "C" },
        },
        buttonUrl: "https://github.com/o/r/pull/7",
      },
      optionsOf(),
      depsOf(telegram),
    );

    expect(telegram.requests.length, "number of requests").toBe(1);
    const [request] = telegram.requests;
    expect(request?.method, "Bot API method").toBe("sendMessage");
    expect(request?.token, "token in the URL").toBe(TOKEN);
    expect(request?.origin, "origin").toBe("https://api.telegram.org");
    expect(request?.httpMethod, "HTTP method").toBe("POST");
    expect(request?.contentType, "Content-Type").toBe("application/json");
    expect(request?.body, "JSON body").toEqual({
      chat_id: CHAT,
      text: "<b>T &lt;b&gt;</b> · o/r #7\nS &amp; S\nC",
      parse_mode: "HTML",
      disable_notification: false,
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: "Open on GitHub", url: "https://github.com/o/r/pull/7" }]] },
    });
  });

  it("TELEGRAM_CHANNEL send posts an old-form row's text unchanged", async () => {
    const telegram = telegramDouble();
    const send = await readySend();
    const text = "<b>New pull request</b> · octo/repo #7\nFix &lt;b&gt; &amp; &lt;/b&gt;\nmain";

    const result = await send(
      { content: { kind: "legacy", text }, buttonUrl: "https://github.com/octo/repo/pull/7" },
      optionsOf(),
      depsOf(telegram),
    );

    expect(result, "result").toBe("sent");
    expect(telegram.requests[0]?.body, "JSON body").toEqual({
      chat_id: CHAT,
      text,
      parse_mode: "HTML",
      disable_notification: false,
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [[{ text: "Open on GitHub", url: "https://github.com/octo/repo/pull/7" }]],
      },
    });
  });

  it("TELEGRAM_CHANNEL send posts an old-form row's text unchanged even when it does not look like Seluna's format", async () => {
    const telegram = telegramDouble();
    const send = await readySend();

    await send({ content: { kind: "legacy", text: "t" }, buttonUrl: undefined }, optionsOf(), depsOf(telegram));

    expect(telegram.requests[0]?.body, "JSON body").toEqual({
      chat_id: CHAT,
      text: "t",
      parse_mode: "HTML",
      disable_notification: false,
      link_preview_options: { is_disabled: true },
    });
  });

  it("TELEGRAM_CHANNEL send sends disable_notification true for a silent row", async () => {
    const telegram = telegramDouble();
    const send = await readySend();

    await send(
      { content: { kind: "legacy", text: "t" }, buttonUrl: undefined },
      optionsOf({ silent: true }),
      depsOf(telegram),
    );

    expect(telegram.requests[0]?.body, "JSON body").toMatchObject({ disable_notification: true });
  });

  it.each<{ case: string; answer: TelegramAnswer | readonly TelegramAnswer[]; result: string }>([
    { case: "answers 200 with ok true", answer: jsonAnswer(200, FIXTURES.sendMessage), result: "sent" },
    { case: "answers 401", answer: jsonAnswer(401, FIXTURES.unauthorized), result: "rejected" },
    { case: "answers 404", answer: jsonAnswer(404, FIXTURES.unauthorized), result: "rejected" },
    { case: "answers 500", answer: jsonAnswer(500, { ok: false }), result: "failed" },
    { case: "answers 200 with ok false", answer: jsonAnswer(200, { ok: false }), result: "failed" },
    { case: "rejects", answer: REJECTED, result: "failed" },
    { case: "answers 429 without retry_after", answer: jsonAnswer(429, { ok: false }), result: "rate-limited" },
    {
      case: "answers 429 twice",
      answer: [jsonAnswer(429, FIXTURES.tooManyRequests), jsonAnswer(429, FIXTURES.tooManyRequests)],
      result: "rate-limited",
    },
  ])("TELEGRAM_CHANNEL send returns $result when sendMessage $case", async ({ answer, result }) => {
    const telegram = telegramDouble({ sendMessage: answer });
    const send = await readySend();

    const sent = await send(
      { content: { kind: "legacy", text: "t" }, buttonUrl: undefined },
      optionsOf(),
      depsOf(telegram),
    );

    expect(sent, "result").toBe(result);
  });

  it("TELEGRAM_CHANNEL send waits the retry_after of a 429 once and sends again", async () => {
    const telegram = telegramDouble({
      sendMessage: [jsonAnswer(429, FIXTURES.tooManyRequests), jsonAnswer(200, FIXTURES.sendMessage)],
    });
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>(() => Promise.resolve());
    const send = await readySend();

    const result = await send(
      { content: { kind: "legacy", text: "t" }, buttonUrl: undefined },
      optionsOf(),
      depsOf(telegram, sleep),
    );

    expect(result, "result").toBe("sent");
    expect(sleep.mock.calls, "sleep calls").toEqual([[3000]]);
    expect(telegram.requests.length, "number of requests").toBe(2);
  });
});

describe("TELEGRAM_CHANNEL prepare", () => {
  it("TELEGRAM_CHANNEL prepare is ready with the token and chat of the Worker secrets and sends to that chat", async () => {
    const telegram = telegramDouble();
    const send = await readySend();

    await send({ content: { kind: "legacy", text: "t" }, buttonUrl: undefined }, optionsOf(), depsOf(telegram));

    expect(telegram.requests[0]?.token, "token in the URL").toBe(TOKEN);
    expect(telegram.requests[0]?.body, "JSON body").toMatchObject({ chat_id: CHAT });
  });

  it("TELEGRAM_CHANNEL prepare reads the chat from the settings when TELEGRAM_CHAT_ID is not set", async () => {
    await writeSetting(env.DB, TELEGRAM_CHAT_ID_SETTING, "-4001001");
    const telegram = telegramDouble();
    const send = await readySend({ TELEGRAM_BOT_TOKEN: TOKEN });

    await send({ content: { kind: "legacy", text: "t" }, buttonUrl: undefined }, optionsOf(), depsOf(telegram));

    expect(telegram.requests[0]?.body, "JSON body").toMatchObject({ chat_id: -4001001 });
  });

  it.each([
    { case: "no token", deliveryEnv: { TELEGRAM_CHAT_ID: String(CHAT) }, result: "no-token" },
    {
      case: "a malformed token",
      deliveryEnv: { TELEGRAM_BOT_TOKEN: "1:a/../setWebhook", TELEGRAM_CHAT_ID: String(CHAT) },
      result: "no-token",
    },
    { case: "a token and no chat", deliveryEnv: { TELEGRAM_BOT_TOKEN: TOKEN }, result: "no-chat" },
    {
      case: "a token and a TELEGRAM_CHAT_ID that is no chat id",
      deliveryEnv: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "abc" },
      result: "no-chat",
    },
  ])("TELEGRAM_CHANNEL prepare is unavailable with $result for $case", async ({ deliveryEnv, result }) => {
    const target = await TELEGRAM_CHANNEL.prepare(deliveryEnv, env.DB);

    expect(target, "target").toEqual({ kind: "unavailable", result });
  });

  it("TELEGRAM_CHANNEL prepare rejects when the database fails", async () => {
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

    await expect(TELEGRAM_CHANNEL.prepare({ TELEGRAM_BOT_TOKEN: TOKEN }, failing), "prepare").rejects.toThrow(
      "The database failed",
    );
  });
});

describe("TELEGRAM_CHANNEL removal", () => {
  it("TELEGRAM_CHANNEL hasRemovableCredentials is false when nothing is saved", async () => {
    const removable = await TELEGRAM_CHANNEL.hasRemovableCredentials({}, env.DB);

    expect(removable, "removable").toBe(false);
  });

  it("TELEGRAM_CHANNEL hasRemovableCredentials is false while TELEGRAM_BOT_TOKEN is set", async () => {
    const removable = await TELEGRAM_CHANNEL.hasRemovableCredentials(READY_ENV, env.DB);

    expect(removable, "removable").toBe(false);
  });

  it("TELEGRAM_CHANNEL remove answers worker-secret while TELEGRAM_BOT_TOKEN is set", async () => {
    const result = await TELEGRAM_CHANNEL.remove(READY_ENV, env.DB);

    expect(result, "result").toBe("worker-secret");
  });

  it("TELEGRAM_CHANNEL remove answers removed when nothing is saved", async () => {
    const result = await TELEGRAM_CHANNEL.remove({}, env.DB);

    expect(result, "result").toBe("removed");
  });
});
