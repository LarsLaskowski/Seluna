import { CI_FAILED_DEFAULT_BRANCH } from "./ci-failed-default-branch";
import { CI_FAILED_PULL_REQUEST } from "./ci-failed-pull-request";
import { CODE_SCANNING_ALERT } from "./code-scanning-alert";
import { DEPENDABOT_ALERT } from "./dependabot-alert";
import { ISSUE_COMMENT } from "./issue-comment";
import { ISSUE_OPENED } from "./issue-opened";
import { PULL_REQUEST_COMMENT } from "./pull-request-comment";
import { PULL_REQUEST_OPENED } from "./pull-request-opened";
import { PULL_REQUEST_READY_FOR_REVIEW } from "./pull-request-ready-for-review";
import { PULL_REQUEST_REVIEW_REQUESTED } from "./pull-request-review-requested";
import type { Rule } from "./rule";
import { REPOSITORY_FORKED } from "./repository-forked";
import { REPOSITORY_STARRED } from "./repository-starred";
import { SECRET_SCANNING_ALERT } from "./secret-scanning-alert";

/** Every notification rule, in the order of the settings. */
export const RULES: readonly Rule[] = [
  PULL_REQUEST_OPENED,
  PULL_REQUEST_READY_FOR_REVIEW,
  PULL_REQUEST_REVIEW_REQUESTED,
  CI_FAILED_DEFAULT_BRANCH,
  CI_FAILED_PULL_REQUEST,
  DEPENDABOT_ALERT,
  CODE_SCANNING_ALERT,
  SECRET_SCANNING_ALERT,
  ISSUE_OPENED,
  ISSUE_COMMENT,
  PULL_REQUEST_COMMENT,
  REPOSITORY_STARRED,
  REPOSITORY_FORKED,
];
