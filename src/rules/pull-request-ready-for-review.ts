import { pullRequestRule } from "./pull-request";
import type { Rule } from "./rule";

/** Reports a pull request that was marked ready for review. */
export const PULL_REQUEST_READY_FOR_REVIEW: Rule = pullRequestRule(
  "pull_request_ready_for_review",
  "ready_for_review",
  (texts) => texts.pullRequestReadyForReview,
);
