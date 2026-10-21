import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import codeScanningCreated from "../test/fixtures/code_scanning_alert/created.json";
import dependabotCreated from "../test/fixtures/dependabot_alert/created.json";
import { body as pingBody, headers as pingHeaders } from "../test/fixtures/ping/form-delivery.json";
import opened from "../test/fixtures/pull_request/opened.json";
import openedDraft from "../test/fixtures/pull_request/opened-draft.json";
import readyForReview from "../test/fixtures/pull_request/ready_for_review.json";
import reviewRequested from "../test/fixtures/pull_request/review_requested.json";
import reviewRequestedDraft from "../test/fixtures/pull_request/review_requested-draft.json";
import secretCreated from "../test/fixtures/secret_scanning_alert/created.json";
import failedPullRequestRun from "../test/fixtures/workflow_run/completed-failure-pull-request.json";
import successfulDefaultBranchRun from "../test/fixtures/workflow_run/completed-success-default-branch.json";
import type { DraftLookup } from "./draft-lookup";
import { RULES } from "./rules/registry";
import type { Notification, Rule, WebhookPayload } from "./rules/rule";
import { readLastDelivery } from "./store/meta";
import { writeSetting } from "./store/settings";
import type { TelegramFetch } from "./telegram";
import { parseWebhookPayload, processWebhook } from "./webhook";
import type { SignedDelivery, WebhookDeps, WebhookOutcome } from "./webhook";
import { applyMigrations, migrationTestDb } from "../test/d1";
import { ABSENT, variant } from "../test/pull-request";
import { SECRET, SECRET_SCANNING_READ_PATHS, replaceStringsOutside, withFields } from "../test/security-alert";
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

/** A signed `pull_request` delivery whose JSON body is `payload`. */
function pullRequestDelivery(payload: object): SignedDelivery {
  return jsonDelivery(JSON.stringify(payload), { event: "pull_request" });
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
    lookUpDraft: vi.fn<DraftLookup>(() => Promise.resolve({ kind: "failed" })),
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

  it("processWebhook sends without sound during the stored quiet hours and stores silent 0", async () => {
    await writeSetting(env.DB, "time_zone", "Europe/Berlin");
    await writeSetting(env.DB, "quiet_hours", "14:00-15:00");
    const { deps, waitUntil, telegram } = harness({ rules: [testRule()] });

    await processWebhook(pingDelivery(), deps);
    await settled(waitUntil);

    expect(sentBody(telegram.requests[0]).disable_notification, "disable_notification").toBe(true);
    const row = await env.DB.prepare("SELECT silent FROM outbox").first();
    expect(row?.silent, "stored silent").toBe(0);
  });

  it("processWebhook sends with sound when quiet hours are off", async () => {
    const { deps, waitUntil, telegram } = harness({ rules: [testRule()] });

    await processWebhook(pingDelivery(), deps);
    await settled(waitUntil);

    expect(sentBody(telegram.requests[0]).disable_notification, "disable_notification").toBe(false);
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

  it("processWebhook writes the message of the real opened pull request delivery", async () => {
    const { deps } = harness({ rules: RULES });

    const outcome = await processWebhook(pullRequestDelivery(opened), deps);

    expect(outcome.status, "status").toBe(202);
    expect(outcome.decision, "decision").toBe("reported");
    expect(await env.DB.prepare("SELECT text, button_url FROM outbox").all(), "outbox rows").toMatchObject({
      results: [
        {
          text: "<b>New pull request</b> · example-owner/example-other-repo #143\n[Docs] Update the contributor documentation\nby example-owner · claude/example-branch → main",
          button_url: "https://github.com/example-owner/example-other-repo/pull/143",
        },
      ],
    });
  });

  it.each<{ fixture: string; payload: object }>([
    { fixture: "opened-draft", payload: openedDraft },
    { fixture: "review_requested-draft", payload: reviewRequestedDraft },
  ])("processWebhook writes no message for the real $fixture delivery", async ({ payload }) => {
    const { deps } = harness({ rules: RULES });

    const outcome = await processWebhook(pullRequestDelivery(payload), deps);

    expect(outcome.status, "status").toBe(202);
    expect(outcome.decision, "decision").toBe("no-match");
    expect(await count("outbox"), "outbox rows").toBe(0);
  });

  it.each<{ fixture: string; payload: object; rule: string }>([
    { fixture: "opened", payload: opened, rule: "pull_request_opened" },
    { fixture: "ready_for_review", payload: readyForReview, rule: "pull_request_ready_for_review" },
    { fixture: "review_requested", payload: reviewRequested, rule: "pull_request_review_requested" },
  ])(
    "processWebhook writes no message for the real $fixture delivery when its rule is off",
    async ({ payload, rule }) => {
      await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?1, 'off')").bind(`rule_${rule}`).run();
      const { deps } = harness({ rules: RULES });

      const outcome = await processWebhook(pullRequestDelivery(payload), deps);

      expect(outcome.status, "status").toBe(202);
      expect(outcome.decision, "decision").toBe("disabled");
      expect(await count("outbox"), "outbox rows").toBe(0);
    },
  );

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

const PR_RUN_REF = { owner: "example-owner", repo: "example-other-repo", number: 296 };
const PR_RUN_TEXT =
  "<b>CI failed in pull request</b> · example-owner/example-other-repo #296\nCodeQL\ntest/failing-workflow · Make the check fail";
const PR_RUN_UNKNOWN_TEXT = PR_RUN_TEXT.replace(
  "CI failed in pull request",
  "CI failed in pull request (draft status unknown)",
);
const MAIN_FAILURE = variant(successfulDefaultBranchRun, ["workflow_run", "conclusion"], "failure");
/** A `pull_requests` entry of the default-branch run's own repository. */
const WITH_ENTRY = { number: 7, base: { repo: { id: 2000 } } };
const MAIN_FAILURE_TEXT =
  "<b>CI failed on main</b> · example-owner/example-repo\nBuild and deploy\nmain · [Docs] Add a security policy (#2)";

/** A signed `workflow_run` delivery whose JSON body is `payload`. */
function workflowRunDelivery(payload: object, delivery = DELIVERY_ID): SignedDelivery {
  return jsonDelivery(JSON.stringify(payload), { event: "workflow_run", delivery });
}

function lookupAnswering(result: Awaited<ReturnType<DraftLookup>>): ReturnType<typeof vi.fn<DraftLookup>> {
  return vi.fn<DraftLookup>(() => Promise.resolve(result));
}

async function switchOff(rule: string): Promise<void> {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?1, 'off')").bind(`rule_${rule}`).run();
}

async function storedTexts(): Promise<unknown[]> {
  const rows = await env.DB.prepare("SELECT text FROM outbox ORDER BY id").all();
  return rows.results.map((row) => row.text);
}

describe("processWebhook with the CI failure rules", () => {
  it("processWebhook sends the CI failure of the real pull request run when the lookup answers not a draft", async () => {
    const lookUpDraft = lookupAnswering({ kind: "ok", draft: false });
    const { deps, waitUntil } = harness({ rules: RULES, lookUpDraft });

    const outcome = await processWebhook(workflowRunDelivery(failedPullRequestRun), deps);
    await settled(waitUntil);

    expect(outcome.decision, "decision").toBe("reported");
    expect(lookUpDraft, "lookup calls").toHaveBeenCalledExactlyOnceWith(3000, PR_RUN_REF);
    expect(await storedTexts(), "stored texts").toEqual([PR_RUN_TEXT]);
  });

  it("processWebhook stores no outbox row and decides no-match when the pull request is a draft", async () => {
    const { deps, waitUntil } = harness({ rules: RULES, lookUpDraft: lookupAnswering({ kind: "ok", draft: true }) });

    const outcome = await processWebhook(workflowRunDelivery(failedPullRequestRun), deps);

    expect(outcome.status, "status").toBe(202);
    expect(outcome.decision, "decision").toBe("no-match");
    expect(await count("outbox"), "outbox rows").toBe(0);
    expect(await count("deliveries"), "deliveries rows").toBe(1);
    expect(waitUntil, "waitUntil calls").not.toHaveBeenCalled();
  });

  it("processWebhook sends the CI failure with the draft-status-unknown title when the lookup fails", async () => {
    const { deps, waitUntil } = harness({ rules: RULES, lookUpDraft: lookupAnswering({ kind: "failed" }) });

    const outcome = await processWebhook(workflowRunDelivery(failedPullRequestRun), deps);
    await settled(waitUntil);

    expect(outcome.decision, "decision").toBe("reported");
    expect(await storedTexts(), "stored texts").toEqual([PR_RUN_UNKNOWN_TEXT]);
  });

  it("processWebhook sends the draft-status-unknown title when the payload has no installation id", async () => {
    const lookUpDraft = lookupAnswering({ kind: "ok", draft: false });
    const { deps, waitUntil } = harness({ rules: RULES, lookUpDraft });

    await processWebhook(workflowRunDelivery(variant(failedPullRequestRun, ["installation"], ABSENT)), deps);
    await settled(waitUntil);

    expect(lookUpDraft, "lookup calls").not.toHaveBeenCalled();
    expect(await storedTexts(), "stored texts").toEqual([PR_RUN_UNKNOWN_TEXT]);
  });

  it("processWebhook makes no draft lookup and decides no-match for the real successful run", async () => {
    const lookUpDraft = lookupAnswering({ kind: "ok", draft: false });
    const { deps } = harness({ rules: RULES, lookUpDraft });

    const outcome = await processWebhook(workflowRunDelivery(successfulDefaultBranchRun), deps);

    expect(outcome.decision, "decision").toBe("no-match");
    expect(lookUpDraft, "lookup calls").not.toHaveBeenCalled();
    expect(await count("outbox"), "outbox rows").toBe(0);
  });

  it("processWebhook sends one default-branch message and makes no lookup for a failed run with a pull request entry", async () => {
    const payload = variant(MAIN_FAILURE, ["workflow_run", "pull_requests"], [WITH_ENTRY]);
    const lookUpDraft = lookupAnswering({ kind: "ok", draft: false });
    const { deps, waitUntil } = harness({ rules: RULES, lookUpDraft });

    const outcome = await processWebhook(workflowRunDelivery(payload), deps);
    await settled(waitUntil);

    expect(outcome.decision, "decision").toBe("reported");
    expect(lookUpDraft, "lookup calls").not.toHaveBeenCalled();
    expect(await storedTexts(), "stored texts").toEqual([MAIN_FAILURE_TEXT]);
  });

  it("processWebhook decides disabled, stores no row and makes no lookup for that run with the default-branch switch off", async () => {
    await switchOff("ci_failed_default_branch");
    const payload = variant(MAIN_FAILURE, ["workflow_run", "pull_requests"], [WITH_ENTRY]);
    const lookUpDraft = lookupAnswering({ kind: "ok", draft: false });
    const { deps } = harness({ rules: RULES, lookUpDraft });

    const outcome = await processWebhook(workflowRunDelivery(payload), deps);

    expect(outcome.decision, "decision").toBe("disabled");
    expect(await count("outbox"), "outbox rows").toBe(0);
    expect(lookUpDraft, "lookup calls").not.toHaveBeenCalled();
  });

  it("processWebhook decides disabled and makes no lookup when the pull request switch is off", async () => {
    await switchOff("ci_failed_pull_request");
    const lookUpDraft = lookupAnswering({ kind: "ok", draft: false });
    const { deps } = harness({ rules: RULES, lookUpDraft });

    const outcome = await processWebhook(workflowRunDelivery(failedPullRequestRun), deps);

    expect(outcome.decision, "decision").toBe("disabled");
    expect(await count("outbox"), "outbox rows").toBe(0);
    expect(lookUpDraft, "lookup calls").not.toHaveBeenCalled();
  });

  it("processWebhook decides disabled for the default-branch failure with its switch off", async () => {
    await switchOff("ci_failed_default_branch");
    const { deps } = harness({ rules: RULES });

    const outcome = await processWebhook(workflowRunDelivery(MAIN_FAILURE), deps);

    expect(outcome.decision, "decision").toBe("disabled");
    expect(await count("outbox"), "outbox rows").toBe(0);
  });

  it("processWebhook stores one row per delivery id for two failed runs and for a re-run", async () => {
    const lookUpDraft = lookupAnswering({ kind: "ok", draft: false });
    const { deps, waitUntil } = harness({ rules: RULES, lookUpDraft });
    const otherWorkflow = variant(failedPullRequestRun, ["workflow_run", "name"], "Lint");
    const rerun = variant(failedPullRequestRun, ["workflow_run", "run_attempt"], 2);

    const outcomes = [
      await processWebhook(workflowRunDelivery(failedPullRequestRun, "delivery-a"), deps),
      await processWebhook(workflowRunDelivery(otherWorkflow, "delivery-b"), deps),
      await processWebhook(workflowRunDelivery(rerun, "delivery-c"), deps),
    ];
    await settled(waitUntil);

    expect(
      outcomes.map((outcome) => outcome.decision),
      "decisions",
    ).toEqual(["reported", "reported", "reported"]);
    expect(await count("outbox"), "outbox rows").toBe(3);
    expect(lookUpDraft, "lookup calls").toHaveBeenCalledTimes(3);
  });

  it("processWebhook makes no lookup for a delivery id already recorded", async () => {
    const lookUpDraft = lookupAnswering({ kind: "ok", draft: false });
    const { deps, waitUntil } = harness({ rules: RULES, lookUpDraft });

    const first = await processWebhook(workflowRunDelivery(failedPullRequestRun, "delivery-d"), deps);
    const second = await processWebhook(workflowRunDelivery(failedPullRequestRun, "delivery-d"), deps);
    await settled(waitUntil);

    expect([first.status, second.status], "statuses").toEqual([202, 200]);
    expect(second.decision, "decision of the second").toBe("duplicate");
    expect(lookUpDraft, "lookup calls").toHaveBeenCalledTimes(1);
    expect(await count("outbox"), "outbox rows").toBe(1);
  });

  it("processWebhook cleans and escapes the branch, workflow name and commit line of a CI failure", async () => {
    const directional = "x\u202Ey";
    const branched = variant(
      variant(MAIN_FAILURE, ["repository", "default_branch"], "a<b>&c"),
      ["workflow_run", "head_branch"],
      "a<b>&c",
    );
    const payload = variant(
      variant(branched, ["workflow_run", "name"], directional),
      ["workflow_run", "head_commit", "message"],
      "<i>&amp;",
    );
    const { deps, waitUntil } = harness({ rules: RULES });

    await processWebhook(workflowRunDelivery(payload), deps);
    await settled(waitUntil);

    expect(directional.codePointAt(1), "input keeps the directional character").toBe(0x202e);
    expect(await storedTexts(), "stored texts").toEqual([
      "<b>CI failed on a&lt;b&gt;&amp;c</b> · example-owner/example-repo\nxy\na&lt;b&gt;&amp;c · &lt;i&gt;&amp;amp;",
    ]);
  });
});

const DEPENDABOT_TEXT =
  "<b>Dependabot alert</b> · example-owner/example-repo #1\nInsertion of Sensitive Information into Log File in ansible\nmedium · ansible";
const DEPENDABOT_BUTTON = "https://github.com/example-owner/example-repo/security/dependabot/1";
const CODE_SCANNING_TEXT =
  '<b>Code scanning alert</b> · example-owner/example-repo #42\nArbitrary file write during zip extraction ("Zip Slip")\nerror · js/zipslip';
const CODE_SCANNING_BUTTON = "https://github.com/example-owner/example-repo/code-scanning/42";
const SECRET_TEXT =
  "<b>Secret scanning alert</b> · example-owner/example-repo #42\nMailchimp API Key\nmailchimp_api_key";
const SECRET_BUTTON = "https://github.com/example-owner/example-repo/security/secret-scanning/42";

/** A signed delivery of a security alert event whose JSON body is `payload`. */
function alertDelivery(event: string, payload: object, delivery = DELIVERY_ID): SignedDelivery {
  return jsonDelivery(JSON.stringify(payload), { event, delivery });
}

async function storedMessages(): Promise<unknown[]> {
  const rows = await env.DB.prepare("SELECT text, button_url FROM outbox ORDER BY id").all();
  return rows.results.map((row) => [row.text, row.button_url]);
}

describe("processWebhook with the security alert rules", () => {
  it.each<{ event: string; payload: WebhookPayload; text: string; button: string }>([
    { event: "dependabot_alert", payload: dependabotCreated, text: DEPENDABOT_TEXT, button: DEPENDABOT_BUTTON },
    {
      event: "code_scanning_alert",
      payload: codeScanningCreated,
      text: CODE_SCANNING_TEXT,
      button: CODE_SCANNING_BUTTON,
    },
    { event: "secret_scanning_alert", payload: secretCreated, text: SECRET_TEXT, button: SECRET_BUTTON },
  ])(
    "processWebhook stores the message of the documented created $event alert",
    async ({ event, payload, text, button }) => {
      const { deps } = harness({ rules: RULES });

      const outcome = await processWebhook(alertDelivery(event, payload), deps);

      expect(outcome.status, "status").toBe(202);
      expect(outcome.decision, "decision").toBe("reported");
      expect(outcome.repository, "repository").toBe("example-owner/example-repo");
      expect(await storedMessages(), "stored messages").toEqual([[text, button]]);
    },
  );

  it.each<{ event: string; payload: WebhookPayload; rule: string }>([
    { event: "dependabot_alert", payload: dependabotCreated, rule: "dependabot_alert" },
    { event: "code_scanning_alert", payload: codeScanningCreated, rule: "code_scanning_alert" },
    { event: "secret_scanning_alert", payload: secretCreated, rule: "secret_scanning_alert" },
  ])(
    "processWebhook decides disabled and stores no row for a created $event with its switch off",
    async ({ event, payload, rule }) => {
      await switchOff(rule);
      const { deps, waitUntil } = harness({ rules: RULES });

      const outcome = await processWebhook(alertDelivery(event, payload), deps);

      expect(outcome.status, "status").toBe(202);
      expect(outcome.decision, "decision").toBe("disabled");
      expect(await count("outbox"), "outbox rows").toBe(0);
      expect(waitUntil, "waitUntil calls").not.toHaveBeenCalled();
    },
  );

  it("processWebhook decides no-match for a dismissed Dependabot alert", async () => {
    const { deps } = harness({ rules: RULES });

    const outcome = await processWebhook(
      alertDelivery("dependabot_alert", variant(dependabotCreated, ["action"], "dismissed")),
      deps,
    );

    expect(outcome.decision, "decision").toBe("no-match");
    expect(outcome.action, "action").toBe("dismissed");
    expect(await count("outbox"), "outbox rows").toBe(0);
  });

  it("processWebhook escapes an advisory summary with <, & and a line break and keeps it on one line", async () => {
    const payload = variant(dependabotCreated, ["alert", "security_advisory", "summary"], "a <b> & c\nd");
    const { deps } = harness({ rules: RULES });

    await processWebhook(alertDelivery("dependabot_alert", payload), deps);

    expect(await storedMessages(), "stored messages").toEqual([
      [
        "<b>Dependabot alert</b> · example-owner/example-repo #1\na &lt;b&gt; &amp; c d\nmedium · ansible",
        DEPENDABOT_BUTTON,
      ],
    ]);
  });

  it("processWebhook stores the same outbox text and button URL and returns the same log fields for a secret scanning delivery with and without a secret", async () => {
    const leaking = withFields(secretCreated, [
      [["alert", "secret"], SECRET],
      [["alert", "resolution_comment"], SECRET],
      [
        ["alert", "locations_url"],
        `https://api.github.com/repos/example-owner/example-repo/secret-scanning/alerts/42/locations?q=${SECRET}`,
      ],
      [["alert", "location"], { path: SECRET, details: { blob_sha: SECRET } }],
    ]);
    const log = vi.fn<WebhookDeps["log"]>();
    const { deps, waitUntil, telegram } = harness({ rules: RULES, log });

    const plainOutcome = await processWebhook(
      alertDelivery("secret_scanning_alert", secretCreated, "delivery-plain"),
      deps,
    );
    const leakingOutcome = await processWebhook(
      alertDelivery("secret_scanning_alert", leaking, "delivery-leaking"),
      deps,
    );
    await settled(waitUntil);

    const stored = await storedMessages();
    expect(stored, "stored messages").toEqual([
      [SECRET_TEXT, SECRET_BUTTON],
      [SECRET_TEXT, SECRET_BUTTON],
    ]);
    expect(leakingOutcome, "log fields of the delivery with the secret").toEqual(plainOutcome);
    expect(
      JSON.stringify([stored, leakingOutcome, log.mock.calls, telegram.requests]),
      "everything stored, logged or sent",
    ).not.toContain(SECRET);
  });

  it("processWebhook stores the same outbox text and button URL for a secret scanning delivery whose other strings are all the secret", async () => {
    const everywhere = replaceStringsOutside(secretCreated, SECRET_SCANNING_READ_PATHS, SECRET);
    const log = vi.fn<WebhookDeps["log"]>();
    const { deps, waitUntil, telegram } = harness({ rules: RULES, log });

    const outcome = await processWebhook(alertDelivery("secret_scanning_alert", everywhere), deps);
    await settled(waitUntil);

    const stored = await storedMessages();
    expect(stored, "stored messages").toEqual([[SECRET_TEXT, SECRET_BUTTON]]);
    expect(outcome.repository, "repository").toBe("example-owner/example-repo");
    expect(outcome.action, "action").toBe("created");
    expect(
      JSON.stringify([stored, outcome, log.mock.calls, telegram.requests]),
      "everything stored, logged or sent",
    ).not.toContain(SECRET);
  });
});
