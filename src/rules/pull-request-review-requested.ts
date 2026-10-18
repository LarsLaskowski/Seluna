import { pullRequestRule } from "./pull-request";
import type { Rule } from "./rule";

/** Reports a review request on a non-draft pull request. */
export const PULL_REQUEST_REVIEW_REQUESTED: Rule = pullRequestRule(
  "pull_request_review_requested",
  "review_requested",
  (texts) => texts.pullRequestReviewRequested,
);
