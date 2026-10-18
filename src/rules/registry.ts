import { PULL_REQUEST_OPENED } from "./pull-request-opened";
import { PULL_REQUEST_READY_FOR_REVIEW } from "./pull-request-ready-for-review";
import { PULL_REQUEST_REVIEW_REQUESTED } from "./pull-request-review-requested";
import type { Rule } from "./rule";

/** Every notification rule, in the order of the settings; the CI (#16) and security alert (#17) rules follow. */
export const RULES: readonly Rule[] = [
  PULL_REQUEST_OPENED,
  PULL_REQUEST_READY_FOR_REVIEW,
  PULL_REQUEST_REVIEW_REQUESTED,
];
