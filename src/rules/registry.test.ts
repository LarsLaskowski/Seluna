import { expect, it } from "vitest";
import { PULL_REQUEST_OPENED } from "./pull-request-opened";
import { PULL_REQUEST_READY_FOR_REVIEW } from "./pull-request-ready-for-review";
import { PULL_REQUEST_REVIEW_REQUESTED } from "./pull-request-review-requested";
import { RULES } from "./registry";

it("RULES holds the three pull request rules in settings order", () => {
  expect(RULES, "rules").toEqual([PULL_REQUEST_OPENED, PULL_REQUEST_READY_FOR_REVIEW, PULL_REQUEST_REVIEW_REQUESTED]);
  expect(
    RULES.map((rule) => rule.id),
    "ids",
  ).toEqual(["pull_request_opened", "pull_request_ready_for_review", "pull_request_review_requested"]);
});
