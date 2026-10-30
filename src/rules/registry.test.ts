import { expect, it } from "vitest";
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
import { RULES } from "./registry";
import { SECRET_SCANNING_ALERT } from "./secret-scanning-alert";

it("RULES lists every rule in settings order, the issue and comment rules last", () => {
  expect(RULES, "rules").toEqual([
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
  ]);
  expect(
    RULES.map((rule) => rule.id),
    "ids",
  ).toEqual([
    "pull_request_opened",
    "pull_request_ready_for_review",
    "pull_request_review_requested",
    "ci_failed_default_branch",
    "ci_failed_pull_request",
    "dependabot_alert",
    "code_scanning_alert",
    "secret_scanning_alert",
    "issue_opened",
    "issue_comment",
    "pull_request_comment",
  ]);
});
