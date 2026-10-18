import { PULL_REQUEST_OPENED } from "./pull-request-opened";
import { PULL_REQUEST_READY_FOR_REVIEW } from "./pull-request-ready-for-review";
import { PULL_REQUEST_REVIEW_REQUESTED } from "./pull-request-review-requested";
import type { Rule } from "./rule";

/** Every notification rule, in evaluation order. */
export const RULES: readonly Rule[] = [
  PULL_REQUEST_OPENED,
  PULL_REQUEST_READY_FOR_REVIEW,
  PULL_REQUEST_REVIEW_REQUESTED,
];
