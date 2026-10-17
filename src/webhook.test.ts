import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { body as pingBody, headers as pingHeaders } from "../test/fixtures/ping/form-delivery.json";
import { RULES } from "./rules/registry";
import type { Notification, Rule } from "./rules/rule";
import { readLastDelivery } from "./store/meta";
import type { TelegramFetch } from "./telegram";
import { parseWebhookPayload, processWebhook } from "./webhook";
import type { SignedDelivery, WebhookDeps, WebhookOutcome } from "./webhook";
import { applyMigrations, migrationTestDb } from "../test/d1";
import { jsonAnswer, telegramDouble } from "../test/telegram";
import type { RecordedRequest, TelegramAnswers } from "../test/telegram";

const TOKEN = "123456789:AAH-throwaway_token0123456789abcdefghij";
const FORM = "application/x-www-form-urlencoded";
const DELIVERY_ID = pingHeaders["x-github-delivery"];
const NOW = new Date(1_792_240_440_000);
const LATER = new Date(1_792_240_500_000);

const encoder = new TextEncoder();

/** The JSON text of the real ping: the decoded `payload` field of its form body. */
const PING_JSON = new URLSearchParams(pingBody).get("payload") ?? "";

beforeEach(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM deliveries"),
    env.DB.prepare("DELETE FROM outbox"),
    env.DB.prepare("DELETE FROM settings"),
    env.DB.prepare("DELETE FROM meta WHERE key = 'last_delivery'"),
  ]);
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pingDelivery(overrides: Partial<SignedDelivery> = {}): SignedDelivery {
  return {
    delivery: DELIVERY_ID,
    event: "ping",
    contentType: FORM,
    body: encoder.encode(pingBody),
    ...overrides,
  };
}

function jsonDelivery(text: string | Uint8Array, overrides: Partial<SignedDelivery> = {}): SignedDelivery {
  return pingDelivery({
    contentType: "application/json",
    body: typeof text === "string" ? encoder.encode(text) : text,
    ...overrides,
  });
}

function notificationWith(subject: string): Notification {
  return {
    title: "New pull request",
    repository: "octo/repo",
    number: 7,
    subject,
    context: "main",
    url: "https://github.com/octo/repo/pull/7",
  };
}

/** A rule that reports a notification for every `ping`. */
function testRule(subject = "Fix the bug", id: Rule["id"] = "pull_request_opened"): Rule {
  return { id, evaluate: (event) => (event === "ping" ? notificationWith(subject) : undefined) };
}

interface Harness {
  readonly deps: WebhookDeps;
  readonly waitUntil: ReturnType<typeof vi.fn<(promise: Promise<void>) => void>>;
  readonly telegram: ReturnType<typeof telegramDouble>;
  readonly sleep: ReturnType<typeof vi.fn<(milliseconds: number) => Promise<void>>>;
}

function harness(
  overrides: Partial<WebhookDeps> = {},
  answers: TelegramAnswers = {},
  deliveryEnv: object = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "5001001" },
): Harness {
  const telegram = telegramDouble(answers);
  const waitUntil = vi.fn<(promise: Promise<void>) => void>();
  const sleep = vi.fn<(milliseconds: number) => Promise<void>>(() => Promise.resolve());
  const deps: WebhookDeps = {
    db: env.DB,
    env: deliveryEnv,
    now: () => NOW,
    rules: [],
    waitUntil,
    telegramFetch: telegram.fetch,
    sleep,
    log: () => undefined,
    ...overrides,
  };
  return { deps, waitUntil, telegram, sleep };
}

/** Waits for every promise handed to `waitUntil`. */
async function settled(waitUntil: Harness["waitUntil"]): Promise<void> {
  await Promise.all(waitUntil.mock.calls.map(([promise]) => promise));
}

async function count(table: "deliveries" | "outbox"): Promise<unknown> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first();
  return row?.n;
}

function sentBody(request: RecordedRequest | undefined): Record<string, unknown> {
  if (request === undefined || !isRecord(request.body)) {
    throw new TypeError("No sendMessage request with a JSON object body was recorded");
  }
  return request.body;
}

describe("processWebhook", () => {
  it("processWebhook sends the escaped title with parse_mode HTML to sendMessage", async () => {
    const { deps, waitUntil, telegram } = harness({ rules: [testRule("Fix <b> & </b>")] });

    const outcome = await processWebhook(pingDelivery(), deps);
    await settled(waitUntil);

    expect(outcome.status, "status").toBe(202);
    const sent = sentBody(telegram.requests[0]);
    expect(sent.text, "text").toBe("<b>New pull request</b> · octo/repo #7\nFix &lt;b&gt; &amp; &lt;/b&gt;\nmain");
    expect(sent.parse_mode, "parse_mode").toBe("HTML");
  });

  it("processWebhook answers 200 to a second delivery with the same id and sends one message", async () => {
    const { deps, waitUntil, telegram } = harness({ rules: [testRule()] });

    const first = await processWebhook(pingDelivery(), deps);
    const second = await processWebhook(pingDelivery(), deps);
    await settled(waitUntil);

    expect([first.status, second.status], "statuses").toEqual([202, 200]);
    expect(second.decision, "decision of the second").toBe("duplicate");
    expect(await count("outbox"), "outbox rows").toBe(1);
    expect(telegram.methods(), "Telegram requests").toEqual(["sendMessage"]);
  });

  it("processWebhook stores one outbox row for two concurrent deliveries with the same id", async () => {
    const { deps } = harness({ rules: [testRule()] });

    const outcomes = await Promise.all([processWebhook(pingDelivery(), deps), processWebhook(pingDelivery(), deps)]);

    expect(
      outcomes.map((outcome) => outcome.status).sort((a, b) => a - b),
      "sorted statuses",
    ).toEqual([200, 202]);
    expect(await count("deliveries"), "deliveries rows").toBe(1);
    expect(await count("outbox"), "outbox rows").toBe(1);
  });

  it("processWebhook leaves last_delivery unchanged for a known delivery id", async () => {
    let clock = NOW;
    const { deps } = harness({ now: () => clock });
    await processWebhook(pingDelivery(), deps);
    clock = LATER;

    await processWebhook(pingDelivery(), deps);

    expect((await readLastDelivery(env.DB))?.getTime(), "last_delivery").toBe(NOW.getTime());
  });

  it("processWebhook answers 202 and leaves the row pending when Telegram answers 500", async () => {
    const { deps, waitUntil } = harness({ rules: [testRule()] }, { sendMessage: jsonAnswer(500, { ok: false }) });

    const outcome = await processWebhook(pingDelivery(), deps);
    await settled(waitUntil);

    expect(outcome.status, "status").toBe(202);
    expect(await env.DB.prepare("SELECT status, attempts FROM outbox").first(), "row").toEqual({
      status: "pending",
      attempts: 1,
    });
  });

  it("processWebhook resolves 202 with the row pending while the send has not finished", async () => {
    const neverSettles: TelegramFetch = () => new Promise<Response>(() => undefined);
    const { deps, waitUntil } = harness({ rules: [testRule()], telegramFetch: neverSettles });

    const outcome = await processWebhook(pingDelivery(), deps);

    expect(outcome.status, "status").toBe(202);
    expect(await env.DB.prepare("SELECT status, attempts FROM outbox").first(), "row").toEqual({
      status: "pending",
      attempts: 0,
    });
    expect(waitUntil, "waitUntil calls").toHaveBeenCalledTimes(1);
  });

  it("processWebhook hands nothing to waitUntil when no row was written", async () => {
    const { deps, waitUntil } = harness({ rules: RULES });

    await processWebhook(pingDelivery(), deps);

    expect(waitUntil, "waitUntil calls").not.toHaveBeenCalled();
  });

  it("processWebhook records the real ping delivery with event ping, answers 202 and writes no outbox row", async () => {
    const { deps } = harness({ rules: RULES });

    const outcome = await processWebhook(pingDelivery(), deps);

    expect(outcome, "outcome").toEqual({
      status: 202,
      decision: "no-match",
      action: null,
      repository: "LarsLaskowski/test",
    });
    expect(await env.DB.prepare("SELECT id, event FROM deliveries").first(), "delivery row").toEqual({
      id: DELIVERY_ID,
      event: "ping",
    });
    expect(await count("outbox"), "outbox rows").toBe(0);
  });

  it("processWebhook writes no outbox row for a disabled rule and returns decision disabled", async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('rule_pull_request_opened', 'off')").run();
    const { deps, waitUntil } = harness({ rules: [testRule("Fix", "pull_request_opened")] });

    const outcome = await processWebhook(pingDelivery(), deps);

    expect(outcome.status, "status").toBe(202);
    expect(outcome.decision, "decision").toBe("disabled");
    expect(await count("outbox"), "outbox rows").toBe(0);
    expect(waitUntil, "waitUntil calls").not.toHaveBeenCalled();
  });

  it("processWebhook stores the clock time as last_delivery for a new delivery", async () => {
    const { deps } = harness();

    await processWebhook(pingDelivery(), deps);

    expect((await readLastDelivery(env.DB))?.getTime(), "last_delivery").toBe(NOW.getTime());
  });

  it("processWebhook answers 503 with decision unavailable and calls no rule and no Telegram when the database has no tables", async () => {
    const evaluate = vi.fn<Rule["evaluate"]>(() => notificationWith("never"));
    const { deps, telegram, waitUntil } = harness({
      db: migrationTestDb(),
      rules: [{ id: "pull_request_opened", evaluate }],
    });

    const outcome = await processWebhook(pingDelivery(), deps);

    expect(outcome.status, "status").toBe(503);
    expect(outcome.decision, "decision").toBe("unavailable");
    expect(evaluate, "rule calls").not.toHaveBeenCalled();
    expect(telegram.requests.length, "Telegram requests").toBe(0);
    expect(waitUntil, "waitUntil calls").not.toHaveBeenCalled();
  });

  it("processWebhook answers 503 with decision unavailable and stores nothing when a rule throws", async () => {
    const throwing: Rule = {
      id: "pull_request_opened",
      evaluate: () => {
        throw new TypeError("unexpected payload shape");
      },
    };
    const { deps, waitUntil } = harness({ rules: [throwing] });

    const outcome = await processWebhook(pingDelivery(), deps);

    expect(outcome.status, "status").toBe(503);
    expect(outcome.decision, "decision").toBe("unavailable");
    expect(await count("deliveries"), "deliveries rows").toBe(0);
    expect(await count("outbox"), "outbox rows").toBe(0);
    expect(waitUntil, "waitUntil calls").not.toHaveBeenCalled();
  });

  it.each<{ case: string; delivery: SignedDelivery }>([
    { case: "a missing delivery header", delivery: pingDelivery({ delivery: null }) },
    { case: "a missing event header", delivery: pingDelivery({ event: null }) },
    { case: "a body that is not JSON", delivery: jsonDelivery("not json") },
    { case: "a body that is a list", delivery: jsonDelivery("[1]") },
    { case: "a body that is a text", delivery: jsonDelivery('"text"') },
    { case: "a body that is null", delivery: jsonDelivery("null") },
    { case: "a form without a payload field", delivery: pingDelivery({ body: encoder.encode("other=1") }) },
    {
      case: "a form with two payload fields",
      delivery: pingDelivery({ body: encoder.encode("payload=%7B%7D&payload=%7B%7D") }),
    },
    { case: "a body with the invalid UTF-8 byte 0xFF", delivery: jsonDelivery(new Uint8Array([0x7b, 0xff, 0x7d])) },
    {
      case: "JSON prefixed with a byte order mark",
      delivery: jsonDelivery(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])),
    },
  ])("processWebhook answers 400 and stores nothing for $case", async ({ delivery }) => {
    const { deps, waitUntil } = harness({ rules: [testRule()] });

    const outcome = await processWebhook(delivery, deps);

    expect(outcome.status, "status").toBe(400);
    expect(outcome.decision, "decision").toBe("invalid");
    expect(await count("deliveries"), "deliveries rows").toBe(0);
    expect(await count("outbox"), "outbox rows").toBe(0);
    expect(await readLastDelivery(env.DB), "last_delivery").toBeUndefined();
    expect(waitUntil, "waitUntil calls").not.toHaveBeenCalled();
  });

  it.each<{ full_name: unknown; expected: string | null; case: string }>([
    { case: "LarsLaskowski/test", full_name: "LarsLaskowski/test", expected: "LarsLaskowski/test" },
    { case: "a name with a space", full_name: "a b/c", expected: null },
    { case: "an owner of 40 characters", full_name: `${"a".repeat(40)}/r`, expected: null },
    { case: "a name without a repository part", full_name: "o/", expected: null },
    { case: "a name with two slashes", full_name: "o/r/x", expected: null },
    { case: "a number", full_name: 5, expected: null },
  ])("processWebhook returns repository $expected for full_name $case", async ({ full_name, expected }) => {
    const { deps } = harness();

    const outcome = await processWebhook(jsonDelivery(JSON.stringify({ repository: { full_name } })), deps);

    expect(outcome.repository, "repository").toBe(expected);
  });

  it("processWebhook returns repository null for a payload without a repository", async () => {
    const { deps } = harness();

    const outcome = await processWebhook(jsonDelivery("{}"), deps);

    expect(outcome.repository, "repository").toBeNull();
  });

  it.each<{ action: string; expected: string | null }>([
    { action: "Opened", expected: null },
    { action: "opened", expected: "opened" },
  ])("processWebhook returns action $expected for the action $action", async ({ action, expected }) => {
    const { deps } = harness();

    const outcome: WebhookOutcome = await processWebhook(jsonDelivery(JSON.stringify({ action })), deps);

    expect(outcome.action, "action").toBe(expected);
  });
});

function fullNameOf(payload: unknown): unknown {
  return isRecord(payload) && isRecord(payload.repository) ? payload.repository.full_name : undefined;
}

describe("parseWebhookPayload", () => {
  it.each<{ case: string; contentType: string | null; form: boolean }>([
    { case: "application/x-www-form-urlencoded", contentType: FORM, form: true },
    {
      case: "Application/X-WWW-Form-Urlencoded ; charset=utf-8",
      contentType: "Application/X-WWW-Form-Urlencoded ; charset=utf-8",
      form: true,
    },
    { case: "application/json", contentType: "application/json", form: false },
    { case: "application/json; charset=utf-8", contentType: "application/json; charset=utf-8", form: false },
    { case: "null", contentType: null, form: false },
  ])("parseWebhookPayload reads the real ping payload with Content-Type $case", ({ contentType, form }) => {
    const bytes = encoder.encode(form ? pingBody : PING_JSON);

    const payload = parseWebhookPayload(bytes, contentType);

    expect(fullNameOf(payload), "repository.full_name").toBe("LarsLaskowski/test");
  });

  it("parseWebhookPayload reads a percent-encoded invalid UTF-8 byte of the form framing as U+FFFD", () => {
    const payload = parseWebhookPayload(encoder.encode("payload=%7B%22a%22%3A%22%FF%22%7D"), FORM);

    expect(isRecord(payload) ? payload.a : undefined, "field a").toBe("\uFFFD");
  });

  it("parseWebhookPayload reads a JSON body as JSON when Content-Type is text/plain", () => {
    const payload = parseWebhookPayload(encoder.encode(PING_JSON), "text/plain");

    expect(fullNameOf(payload), "repository.full_name").toBe("LarsLaskowski/test");
  });
});
