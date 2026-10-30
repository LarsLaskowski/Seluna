import { describe, expect, it } from "vitest";
import opened from "../../test/fixtures/pull_request/opened.json";
import reviewRequested from "../../test/fixtures/pull_request/review_requested.json";
import reviewRequestedDraft from "../../test/fixtures/pull_request/review_requested-draft.json";
import { ABSENT, variant } from "../../test/pull-request";
import { DEFAULT_SETTINGS } from "../settings";
import { PULL_REQUEST_REVIEW_REQUESTED } from "./pull-request-review-requested";

const GERMAN = { ...DEFAULT_SETTINGS, language: "de" } as const;
const EXPECTED = {
  title: "Review requested",
  repository: "example-owner/example-repo",
  number: 274,
  subject: "[Docs] Document an example limitation",
  context: "by example-owner · claude/example-branch → main",
  url: "https://github.com/example-owner/example-repo/pull/274",
};

describe("PULL_REQUEST_REVIEW_REQUESTED", () => {
  it("PULL_REQUEST_REVIEW_REQUESTED reports the real review_requested delivery in English", () => {
    const notification = PULL_REQUEST_REVIEW_REQUESTED.evaluate(
      "pull_request",
      reviewRequested,
      DEFAULT_SETTINGS,
      undefined,
    );

    expect(PULL_REQUEST_REVIEW_REQUESTED.id, "id").toBe("pull_request_review_requested");
    expect(notification, "notification").toEqual(EXPECTED);
  });

  it("PULL_REQUEST_REVIEW_REQUESTED reports the real review_requested delivery in German", () => {
    const notification = PULL_REQUEST_REVIEW_REQUESTED.evaluate("pull_request", reviewRequested, GERMAN, undefined);

    expect(notification, "notification").toEqual({
      ...EXPECTED,
      title: "Review angefordert",
      context: "von example-owner · claude/example-branch → main",
    });
  });

  it("PULL_REQUEST_REVIEW_REQUESTED does not read the requested reviewer", () => {
    const payload = variant(reviewRequested, ["requested_reviewer"], ABSENT);

    const notification = PULL_REQUEST_REVIEW_REQUESTED.evaluate("pull_request", payload, DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toEqual(EXPECTED);
  });

  it("PULL_REQUEST_REVIEW_REQUESTED ignores the real review_requested delivery on a draft", () => {
    const notification = PULL_REQUEST_REVIEW_REQUESTED.evaluate(
      "pull_request",
      reviewRequestedDraft,
      DEFAULT_SETTINGS,
      undefined,
    );

    expect(notification, "notification").toBeUndefined();
  });

  it("PULL_REQUEST_REVIEW_REQUESTED ignores an opened delivery", () => {
    const notification = PULL_REQUEST_REVIEW_REQUESTED.evaluate("pull_request", opened, DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toBeUndefined();
  });
});
