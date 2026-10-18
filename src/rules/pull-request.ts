import type { MessageTexts } from "../i18n/messages";
import type { RuleId } from "../settings";
import type { Rule, WebhookPayload } from "./rule";

/** The `pull_request` actions a rule reports. */
export type PullRequestAction = "opened" | "ready_for_review" | "review_requested";

/** The fields of a pull request delivery the rules read, narrowed. */
export interface PullRequestFields {
  /** `repository.full_name`. */
  readonly repository: string;
  /** `pull_request.number`, a whole number from 1 to 2^53 - 1. */
  readonly number: number;
  /** `pull_request.title`. */
  readonly title: string;
  /** `pull_request.html_url`. */
  readonly url: string;
  /** `pull_request.user.login`. */
  readonly author: string;
  /** `pull_request.head.ref`. */
  readonly head: string;
  /** `pull_request.base.ref`. */
  readonly base: string;
}

/** The fields of a `pull_request` delivery with `action` whose `draft` is `false`; otherwise `undefined`. */
export function nonDraftPullRequest(
  event: string,
  payload: WebhookPayload,
  action: PullRequestAction,
): PullRequestFields | undefined {
  void event;
  void payload;
  void action;
  throw new Error("Not implemented");
}

/** A rule that reports a non-draft `pull_request` delivery with `action` under the title `title` selects. */
export function pullRequestRule(id: RuleId, action: PullRequestAction, title: (texts: MessageTexts) => string): Rule {
  void id;
  void action;
  void title;
  throw new Error("Not implemented");
}
