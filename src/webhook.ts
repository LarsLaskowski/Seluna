import { deliverMessages } from "./delivery";
import type { DeliveryLogEntry, PendingMessage } from "./delivery";
import { applyDraftChecks } from "./draft-lookup";
import type { DraftLookup } from "./draft-lookup";
import { installationIdOf } from "./github/api-client";
import { formatMessage } from "./message";
import { storedNotificationOf } from "./notification";
import { runRules } from "./rules/rule";
import type { Notification, Rule, RuleDecision, WebhookPayload } from "./rules/rule";
import { recordDelivery, isKnownDelivery } from "./store/deliveries";
import { readNotificationSettings } from "./store/settings";
import type { NotificationSettings } from "./settings";
import type { TelegramFetch } from "./telegram";

const FORM_MEDIA_TYPE = "application/x-www-form-urlencoded";
const ACTION_PATTERN = /^[a-z_]{1,64}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface SignedDelivery {
  /** `X-GitHub-Delivery` when it matches its pattern, else `null`. */
  readonly delivery: string | null;
  /** `X-GitHub-Event` when it matches its pattern, else `null`. */
  readonly event: string | null;
  readonly contentType: string | null;
  readonly body: Uint8Array;
}

export type WebhookDecision = "reported" | "no-match" | "disabled" | "duplicate" | "invalid" | "unavailable";

export interface WebhookOutcome {
  readonly status: 200 | 202 | 400 | 503;
  readonly decision: WebhookDecision;
  readonly action: string | null;
  readonly repository: string | null;
}

export interface WebhookDeps {
  readonly db: D1Database;
  readonly env: object;
  readonly now: () => Date;
  readonly rules: readonly Rule[];
  readonly waitUntil: (promise: Promise<void>) => void;
  readonly telegramFetch: TelegramFetch;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly log: (entry: DeliveryLogEntry) => void;
  /** Asks GitHub whether a pull request is a draft; never rejects. */
  readonly lookUpDraft: DraftLookup;
}

/** The payload: a JSON object from the body (or its form field `payload`), else `undefined`. Never throws. */
export function parseWebhookPayload(body: Uint8Array, contentType: string | null): WebhookPayload | undefined {
  try {
    // `ignoreBOM` keeps a byte order mark in the text, so it makes the JSON invalid instead of being dropped silently.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
    const mediaType = (contentType?.split(";")[0] ?? "").trim().toLowerCase();
    let jsonText = text;
    if (mediaType === FORM_MEDIA_TYPE) {
      const fields = new URLSearchParams(text).getAll("payload");
      const [field] = fields;
      if (fields.length !== 1 || field === undefined) {
        return undefined;
      }
      jsonText = field;
    }
    const parsed: unknown = JSON.parse(jsonText);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** `action` and `repository.full_name` when they match their log patterns, else `null`. */
export function logFieldsOf(payload: WebhookPayload): {
  readonly action: string | null;
  readonly repository: string | null;
} {
  const { action, repository } = payload;
  const fullName = isRecord(repository) ? repository.full_name : undefined;
  return {
    action: typeof action === "string" && ACTION_PATTERN.test(action) ? action : null,
    repository: typeof fullName === "string" && REPOSITORY_PATTERN.test(fullName) ? fullName : null,
  };
}

const NO_FIELDS = { action: null, repository: null } as const;

function outcomeOf(
  status: WebhookOutcome["status"],
  decision: WebhookDecision,
  fields: Pick<WebhookOutcome, "action" | "repository"> = NO_FIELDS,
): WebhookOutcome {
  return { status, decision, ...fields };
}

/**
 * Runs the rules, resolves the draft checks of their notifications and renders what is left; any throw is left to the
 * caller. A reported run whose notifications are all dropped as drafts is `no-match`.
 */
async function notificationsOf(
  event: string,
  payload: WebhookPayload,
  settings: NotificationSettings,
  deps: WebhookDeps,
): Promise<{ readonly decision: RuleDecision; readonly notifications: readonly Notification[] }> {
  const run = runRules(deps.rules, event, payload, settings);
  const notifications = await applyDraftChecks(run.notifications, installationIdOf(payload), deps.lookUpDraft);
  const decision = run.decision === "reported" && notifications.length === 0 ? "no-match" : run.decision;
  return { decision, notifications };
}

/** Records a signed delivery, evaluates the rules, stores the messages and hands their sending to `waitUntil`. */
export async function processWebhook(delivery: SignedDelivery, deps: WebhookDeps): Promise<WebhookOutcome> {
  const { delivery: id, event } = delivery;
  if (id === null || event === null) {
    return outcomeOf(400, "invalid");
  }
  try {
    if (await isKnownDelivery(deps.db, id)) {
      return outcomeOf(200, "duplicate");
    }
  } catch {
    return outcomeOf(503, "unavailable");
  }
  const payload = parseWebhookPayload(delivery.body, delivery.contentType);
  if (payload === undefined) {
    return outcomeOf(400, "invalid");
  }
  const fields = logFieldsOf(payload);
  try {
    const settings = await readNotificationSettings(deps.db);
    const { decision, notifications } = await notificationsOf(event, payload, settings, deps);
    const messages = notifications.map((notification) => formatMessage(notification));
    const rows = notifications.map((notification, index) => ({
      notification: storedNotificationOf(notification),
      buttonUrl: messages[index]?.buttonUrl,
      silent: false,
    }));
    const recorded = await recordDelivery(deps.db, { id, event, receivedAt: deps.now() }, rows);
    if (recorded.kind === "duplicate") {
      return outcomeOf(200, "duplicate");
    }
    const pending: PendingMessage[] = [];
    rows.forEach((row, index) => {
      const outboxId = recorded.outboxIds[index];
      if (outboxId !== undefined) {
        pending.push({ id: outboxId, text: messages[index]?.text ?? "", buttonUrl: row.buttonUrl, silent: row.silent });
      }
    });
    if (pending.length > 0) {
      deps.waitUntil(
        deliverMessages(pending, settings, {
          env: deps.env,
          db: deps.db,
          fetch: deps.telegramFetch,
          sleep: deps.sleep,
          log: deps.log,
          now: deps.now,
        }),
      );
    }
    return outcomeOf(202, decision, fields);
  } catch {
    // Database errors and a throwing rule or formatter alike: nothing was stored, and the error text is dropped.
    return outcomeOf(503, "unavailable", fields);
  }
}
