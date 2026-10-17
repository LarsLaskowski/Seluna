import type { DeliveryLogEntry } from "./delivery";
import type { Rule, WebhookPayload } from "./rules/rule";
import type { TelegramFetch } from "./telegram";

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
}

/** The payload: a JSON object from the body (or its form field `payload`), else `undefined`. Never throws. */
export function parseWebhookPayload(body: Uint8Array, contentType: string | null): WebhookPayload | undefined {
  void [body, contentType];
  throw new Error("Not implemented");
}

/** `action` and `repository.full_name` when they match their log patterns, else `null`. */
export function logFieldsOf(payload: WebhookPayload): {
  readonly action: string | null;
  readonly repository: string | null;
} {
  void payload;
  throw new Error("Not implemented");
}

/** Records a signed delivery, evaluates the rules, stores the messages and hands their sending to `waitUntil`. */
export async function processWebhook(delivery: SignedDelivery, deps: WebhookDeps): Promise<WebhookOutcome> {
  void [delivery, deps];
  return Promise.reject(new Error("Not implemented"));
}
