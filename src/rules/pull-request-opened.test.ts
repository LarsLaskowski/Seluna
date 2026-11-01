import { describe, expect, it } from "vitest";
import opened from "../../test/fixtures/pull_request/opened.json";
import openedDraft from "../../test/fixtures/pull_request/opened-draft.json";
import readyForReview from "../../test/fixtures/pull_request/ready_for_review.json";
import { DEFAULT_SETTINGS } from "../settings";
import { PULL_REQUEST_OPENED } from "./pull-request-opened";

const GERMAN = { ...DEFAULT_SETTINGS, language: "de" } as const;
const EXPECTED = {
  title: "New pull request",
  repository: "example-owner/example-other-repo",
  number: 143,
  subject: "[Docs] Update the contributor documentation",
  context: "by example-owner · claude/example-branch → main",
  url: "https://github.com/example-owner/example-other-repo/pull/143",
};

describe("PULL_REQUEST_OPENED", () => {
  it("PULL_REQUEST_OPENED reports the real opened delivery in English", () => {
    const notification = PULL_REQUEST_OPENED.evaluate("pull_request", opened, DEFAULT_SETTINGS, undefined);

    expect(PULL_REQUEST_OPENED.id, "id").toBe("pull_request_opened");
    expect(notification, "notification").toEqual(EXPECTED);
  });

  it("PULL_REQUEST_OPENED reports the real opened delivery in German", () => {
    const notification = PULL_REQUEST_OPENED.evaluate("pull_request", opened, GERMAN, undefined);

    expect(notification, "notification").toEqual({
      ...EXPECTED,
      title: "Neuer Pull Request",
      context: "von example-owner · claude/example-branch → main",
    });
  });

  it("PULL_REQUEST_OPENED ignores the real draft opened delivery", () => {
    const notification = PULL_REQUEST_OPENED.evaluate("pull_request", openedDraft, DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toBeUndefined();
  });

  it("PULL_REQUEST_OPENED ignores a ready_for_review delivery", () => {
    const notification = PULL_REQUEST_OPENED.evaluate("pull_request", readyForReview, DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toBeUndefined();
  });
});
