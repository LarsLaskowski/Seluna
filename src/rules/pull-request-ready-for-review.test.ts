import { describe, expect, it } from "vitest";
import opened from "../../test/fixtures/pull_request/opened.json";
import readyForReview from "../../test/fixtures/pull_request/ready_for_review.json";
import { variant } from "../../test/pull-request";
import { DEFAULT_SETTINGS } from "../settings";
import { PULL_REQUEST_READY_FOR_REVIEW } from "./pull-request-ready-for-review";

const GERMAN = { ...DEFAULT_SETTINGS, language: "de" } as const;
const EXPECTED = {
  title: "Ready for review",
  repository: "example-owner/example-repo",
  number: 274,
  subject: "[Docs] Document an example limitation",
  context: "by example-owner · claude/example-branch → main",
  url: "https://github.com/example-owner/example-repo/pull/274",
};

describe("PULL_REQUEST_READY_FOR_REVIEW", () => {
  it("PULL_REQUEST_READY_FOR_REVIEW reports the real ready_for_review delivery in English", () => {
    const notification = PULL_REQUEST_READY_FOR_REVIEW.evaluate(
      "pull_request",
      readyForReview,
      DEFAULT_SETTINGS,
      undefined,
    );

    expect(PULL_REQUEST_READY_FOR_REVIEW.id, "id").toBe("pull_request_ready_for_review");
    expect(notification, "notification").toEqual(EXPECTED);
  });

  it("PULL_REQUEST_READY_FOR_REVIEW reports the real ready_for_review delivery in German", () => {
    const notification = PULL_REQUEST_READY_FOR_REVIEW.evaluate("pull_request", readyForReview, GERMAN, undefined);

    expect(notification, "notification").toEqual({
      ...EXPECTED,
      title: "Bereit zum Review",
      context: "von example-owner · claude/example-branch → main",
    });
  });

  it("PULL_REQUEST_READY_FOR_REVIEW ignores a ready_for_review payload that claims a draft", () => {
    const payload = variant(readyForReview, ["pull_request", "draft"], true);

    const notification = PULL_REQUEST_READY_FOR_REVIEW.evaluate("pull_request", payload, DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toBeUndefined();
  });

  it("PULL_REQUEST_READY_FOR_REVIEW ignores an opened delivery", () => {
    const notification = PULL_REQUEST_READY_FOR_REVIEW.evaluate("pull_request", opened, DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toBeUndefined();
  });
});
