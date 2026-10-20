import type { PullRequestRef } from "../github/api-client";
import type { NotificationSettings, RuleId } from "../settings";

/** A webhook payload: a JSON object, its fields still unknown. */
export type WebhookPayload = Readonly<Record<string, unknown>>;

/** The pull request whose draft state decides whether a notification is sent. */
export interface DraftCheck {
  readonly pullRequest: PullRequestRef;
  /** Line 1 title used instead of `title` when the draft state cannot be read. */
  readonly titleWhenUnknown: string;
}

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
  /** Set when the notification may only be sent for a pull request that is not a draft. */
  readonly draftCheck?: DraftCheck;
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
  const notifications: Notification[] = [];
  let droppedAny = false;
  for (const rule of rules) {
    const notification = rule.evaluate(event, payload, settings);
    if (notification === undefined) {
      continue;
    }
    if (settings.rules[rule.id]) {
      notifications.push(notification);
    } else {
      droppedAny = true;
    }
  }
  if (notifications.length > 0) {
    return { notifications, decision: "reported" };
  }
  return { notifications, decision: droppedAny ? "disabled" : "no-match" };
}
