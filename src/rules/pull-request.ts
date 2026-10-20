import { MESSAGE_TEXTS } from "../i18n/messages";
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

/** The fields of a `pull_request` delivery with `action` whose `draft` is `false`; otherwise `undefined`. */
export function nonDraftPullRequest(
  event: string,
  payload: WebhookPayload,
  action: PullRequestAction,
): PullRequestFields | undefined {
  if (event !== "pull_request" || payload.action !== action) {
    return undefined;
  }
  const pullRequest = recordField(payload, "pull_request");
  if (pullRequest?.draft !== false) {
    return undefined;
  }
  const number = pullRequest.number;
  const repository = stringField(recordField(payload, "repository") ?? {}, "full_name");
  const title = stringField(pullRequest, "title");
  const url = stringField(pullRequest, "html_url");
  const author = stringField(recordField(pullRequest, "user") ?? {}, "login");
  const head = stringField(recordField(pullRequest, "head") ?? {}, "ref");
  const base = stringField(recordField(pullRequest, "base") ?? {}, "ref");
  if (
    typeof number !== "number" ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    repository === undefined ||
    title === undefined ||
    url === undefined ||
    author === undefined ||
    head === undefined ||
    base === undefined
  ) {
    return undefined;
  }
  return { repository, number, title, url, author, head, base };
}

/** A rule that reports a non-draft `pull_request` delivery with `action` under the title `title` selects. */
export function pullRequestRule(id: RuleId, action: PullRequestAction, title: (texts: MessageTexts) => string): Rule {
  return {
    id,
    evaluate: (event, payload, settings) => {
      const fields = nonDraftPullRequest(event, payload, action);
      if (fields === undefined) {
        return undefined;
      }
      const texts = MESSAGE_TEXTS[settings.language];
      return {
        title: title(texts),
        repository: fields.repository,
        number: fields.number,
        subject: fields.title,
        context: texts.pullRequestContext(fields.author, fields.head, fields.base),
        url: fields.url,
      };
    },
  };
}
