import type { NotificationSettings, RuleId } from "../settings";

/** A webhook payload: a JSON object, its fields still unknown. */
export type WebhookPayload = Readonly<Record<string, unknown>>;

export interface Notification {
  /** Line 1, bold: the case, in the notification language. */
  readonly title: string;
  /** Line 1: `owner/repo`. */
  readonly repository: string;
  /** Line 1: pull request or alert number; `undefined` when the case has none. */
  readonly number: number | undefined;
  /** Line 2. */
  readonly subject: string;
  /** Line 3. */
  readonly context: string;
  /** Target of the button: `html_url` from the payload. */
  readonly url: string;
}

export interface Rule {
  readonly id: RuleId;
  readonly evaluate: (
    event: string,
    payload: WebhookPayload,
    settings: NotificationSettings,
  ) => Notification | undefined;
}

export type RuleDecision = "reported" | "no-match" | "disabled";

export interface RuleRun {
  readonly notifications: readonly Notification[];
  readonly decision: RuleDecision;
}

/** Evaluates every rule; only the notifications of enabled rules are returned. */
export function runRules(
  rules: readonly Rule[],
  event: string,
  payload: WebhookPayload,
  settings: NotificationSettings,
): RuleRun {
  void [rules, event, payload, settings];
  throw new Error("Not implemented");
}
