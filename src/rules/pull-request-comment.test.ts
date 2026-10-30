import { describe, expect, it } from "vitest";
import created from "../../test/fixtures/issue_comment/created.json";
import draftPullRequestComment from "../../test/fixtures/issue_comment/created-draft-pull-request.json";
import pullRequestComment from "../../test/fixtures/issue_comment/created-pull-request.json";
import opened from "../../test/fixtures/issues/opened.json";
import {
  EMPTY_BODIES,
  fromBot,
  fromOwner,
  MALFORMED_COMMENT_FIELDS,
  MALFORMED_ISSUE_FIELDS,
  MALFORMED_SENDERS,
  ORGANIZATION_OWNER,
  OTHER_COMMENT_ACTIONS,
  OWNER,
} from "../../test/issue";
import type { EmptyBody, MalformedField } from "../../test/issue";
import { ABSENT, variant } from "../../test/pull-request";
import { DEFAULT_SETTINGS } from "../settings";
import { PULL_REQUEST_COMMENT } from "./pull-request-comment";
import type { WebhookPayload } from "./rule";

const GERMAN = { ...DEFAULT_SETTINGS, language: "de" } as const;
const EXPECTED = {
  title: "New comment on pull request",
  repository: "example-owner/example-repo",
  number: 12,
  subject: "Example pull request from another user",
  context: "by example-other-user · An example comment on a pull request written by another user.",
  url: "https://github.com/example-owner/example-repo/pull/12#issuecomment-5000002",
};
const UNKNOWN_DRAFT = variant(pullRequestComment, ["issue", "draft"], ABSENT);

function evaluate(payload: WebhookPayload): ReturnType<typeof PULL_REQUEST_COMMENT.evaluate> {
  return PULL_REQUEST_COMMENT.evaluate("issue_comment", payload, DEFAULT_SETTINGS, OWNER);
}

describe("PULL_REQUEST_COMMENT", () => {
  it("PULL_REQUEST_COMMENT reports a comment on a pull request whose issue.draft is false, without a draft check", () => {
    const notification = PULL_REQUEST_COMMENT.evaluate("issue_comment", pullRequestComment, DEFAULT_SETTINGS, OWNER);

    expect(PULL_REQUEST_COMMENT.id, "id").toBe("pull_request_comment");
    expect(notification, "notification").toEqual(EXPECTED);
    expect(notification?.draftCheck, "draft check").toBeUndefined();
  });

  it("PULL_REQUEST_COMMENT reports in German", () => {
    const notification = PULL_REQUEST_COMMENT.evaluate("issue_comment", pullRequestComment, GERMAN, OWNER);

    expect(notification, "notification").toEqual({
      ...EXPECTED,
      title: "Neuer Kommentar zum Pull Request",
      context: "von example-other-user · An example comment on a pull request written by another user.",
    });
  });

  it("PULL_REQUEST_COMMENT ignores a comment on an issue", () => {
    const notification = evaluate(created);

    expect(notification, "notification").toBeUndefined();
  });

  it("PULL_REQUEST_COMMENT ignores a comment whose issue.draft is true", () => {
    const notification = evaluate(draftPullRequestComment);

    expect(notification, "notification").toBeUndefined();
  });

  it("PULL_REQUEST_COMMENT sets a draft check that drops on an unknown state when issue.draft is absent", () => {
    const notification = evaluate(UNKNOWN_DRAFT);

    expect(notification, "notification").toEqual({
      ...EXPECTED,
      draftCheck: {
        pullRequest: { owner: "example-owner", repo: "example-repo", number: 12 },
        titleWhenUnknown: undefined,
      },
    });
    expect(notification?.draftCheck?.titleWhenUnknown, "no title for an unknown state").toBeUndefined();
  });

  it("PULL_REQUEST_COMMENT sets the draft check in German as well, without a title for an unknown state", () => {
    const notification = PULL_REQUEST_COMMENT.evaluate("issue_comment", UNKNOWN_DRAFT, GERMAN, OWNER);

    expect(notification?.title, "title").toBe("Neuer Kommentar zum Pull Request");
    expect(notification?.draftCheck?.titleWhenUnknown, "no title for an unknown state").toBeUndefined();
    expect(notification?.draftCheck?.pullRequest.number, "pull request of the check").toBe(12);
  });

  it("PULL_REQUEST_COMMENT names the comment's author on line 3, not the pull request's", () => {
    const payload = variant(pullRequestComment, ["comment", "user", "login"], "commenter");

    const notification = evaluate(payload);

    expect(notification?.context, "line 3").toBe(
      "by commenter · An example comment on a pull request written by another user.",
    );
  });

  it("PULL_REQUEST_COMMENT ignores the owner's delivery and a bot's", () => {
    const own = evaluate(fromOwner(pullRequestComment));
    const bot = evaluate(fromBot(pullRequestComment));
    const ownUnknownDraft = evaluate(fromOwner(UNKNOWN_DRAFT));

    expect(own, "owner's delivery").toBeUndefined();
    expect(bot, "bot's delivery").toBeUndefined();
    expect(ownUnknownDraft, "owner's delivery without issue.draft").toBeUndefined();
  });

  it.each<{ case: string; owner: typeof OWNER | undefined }>([
    { case: "an organization owner", owner: ORGANIZATION_OWNER },
    { case: "an unknown owner", owner: undefined },
  ])("PULL_REQUEST_COMMENT reports the delivery of the owner's id with $case", ({ owner }) => {
    const notification = PULL_REQUEST_COMMENT.evaluate(
      "issue_comment",
      fromOwner(pullRequestComment),
      DEFAULT_SETTINGS,
      owner,
    );

    expect(notification?.title, "title").toBe("New comment on pull request");
  });

  it.each(OTHER_COMMENT_ACTIONS)("PULL_REQUEST_COMMENT ignores every other issue_comment action: %j", (action) => {
    const notification = evaluate(variant(pullRequestComment, ["action"], action));

    expect(notification, "notification").toBeUndefined();
  });

  it.each(["issues", "pull_request", "star", ""])(
    "PULL_REQUEST_COMMENT ignores its payload under the event name %j",
    (event) => {
      const notification = PULL_REQUEST_COMMENT.evaluate(event, pullRequestComment, DEFAULT_SETTINGS, OWNER);

      expect(notification, "notification").toBeUndefined();
    },
  );

  it("PULL_REQUEST_COMMENT ignores an issues payload under the issue_comment event name", () => {
    const notification = evaluate(variant(opened, ["action"], "created"));

    expect(notification, "notification").toBeUndefined();
  });

  it.each<EmptyBody>(EMPTY_BODIES)("PULL_REQUEST_COMMENT writes line 3 as the author alone for $case", ({ body }) => {
    const notification = evaluate(variant(pullRequestComment, ["comment", "body"], body));

    expect(notification?.context, "line 3").toBe("by example-other-user");
    expect(notification?.title, "the case is still reported").toBe("New comment on pull request");
  });

  it.each<{ case: string; value: unknown }>([
    { case: "a string", value: "true" },
    { case: "a number", value: 1 },
    { case: "null", value: null },
  ])("PULL_REQUEST_COMMENT reports nothing when issue.draft is $case", ({ value }) => {
    const notification = evaluate(variant(pullRequestComment, ["issue", "draft"], value));

    expect(notification, "notification").toBeUndefined();
  });

  it.each<MalformedField>(MALFORMED_ISSUE_FIELDS)(
    "PULL_REQUEST_COMMENT reports nothing when $field is $label",
    ({ path, value }) => {
      const notification = evaluate(variant(pullRequestComment, path, value));

      expect(notification, "notification").toBeUndefined();
    },
  );

  it.each<MalformedField>(MALFORMED_COMMENT_FIELDS)(
    "PULL_REQUEST_COMMENT reports nothing when $field is $label",
    ({ path, value }) => {
      const notification = evaluate(variant(pullRequestComment, path, value));

      expect(notification, "notification").toBeUndefined();
    },
  );

  it.each<MalformedField>(MALFORMED_SENDERS)(
    "PULL_REQUEST_COMMENT reports nothing when $field is $label",
    ({ path, value }) => {
      const notification = evaluate(variant(pullRequestComment, path, value));

      expect(notification, "notification").toBeUndefined();
    },
  );
});
