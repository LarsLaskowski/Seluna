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
import { variant } from "../../test/pull-request";
import { DEFAULT_SETTINGS } from "../settings";
import { ISSUE_COMMENT } from "./issue-comment";
import type { WebhookPayload } from "./rule";

const GERMAN = { ...DEFAULT_SETTINGS, language: "de" } as const;
const EXPECTED = {
  title: "New comment on issue",
  repository: "example-owner/example-repo",
  number: 7,
  subject: "Example issue from another user",
  context: "by example-other-user · An example comment written by another user.",
  url: "https://github.com/example-owner/example-repo/issues/7#issuecomment-5000001",
};

function evaluate(payload: WebhookPayload): ReturnType<typeof ISSUE_COMMENT.evaluate> {
  return ISSUE_COMMENT.evaluate("issue_comment", payload, DEFAULT_SETTINGS, OWNER);
}

describe("ISSUE_COMMENT", () => {
  it("ISSUE_COMMENT reports the comment on an issue", () => {
    const notification = ISSUE_COMMENT.evaluate("issue_comment", created, DEFAULT_SETTINGS, OWNER);

    expect(ISSUE_COMMENT.id, "id").toBe("issue_comment");
    expect(notification, "notification").toEqual(EXPECTED);
    expect(notification?.draftCheck, "draft check").toBeUndefined();
  });

  it("ISSUE_COMMENT reports in German", () => {
    const notification = ISSUE_COMMENT.evaluate("issue_comment", created, GERMAN, OWNER);

    expect(notification, "notification").toEqual({
      ...EXPECTED,
      title: "Neuer Kommentar zum Issue",
      context: "von example-other-user · An example comment written by another user.",
    });
  });

  it("ISSUE_COMMENT names the comment's author on line 3, not the issue's", () => {
    const payload = variant(
      variant(created, ["issue", "user", "login"], "issue-author"),
      ["comment", "user", "login"],
      "commenter",
    );

    const notification = evaluate(payload);

    expect(notification?.context, "line 3").toBe("by commenter · An example comment written by another user.");
  });

  it.each<{ case: string; payload: WebhookPayload }>([
    { case: "a ready pull request", payload: pullRequestComment },
    { case: "a draft pull request", payload: draftPullRequestComment },
  ])("ISSUE_COMMENT ignores a comment on $case", ({ payload }) => {
    const notification = evaluate(payload);

    expect(notification, "notification").toBeUndefined();
  });

  it("ISSUE_COMMENT ignores the owner's delivery and a bot's", () => {
    const own = evaluate(fromOwner(created));
    const bot = evaluate(fromBot(created));

    expect(own, "owner's delivery").toBeUndefined();
    expect(bot, "bot's delivery").toBeUndefined();
  });

  it.each<{ case: string; owner: typeof OWNER | undefined }>([
    { case: "an organization owner", owner: ORGANIZATION_OWNER },
    { case: "an unknown owner", owner: undefined },
  ])("ISSUE_COMMENT reports the delivery of the owner's id with $case", ({ owner }) => {
    const notification = ISSUE_COMMENT.evaluate("issue_comment", fromOwner(created), DEFAULT_SETTINGS, owner);

    expect(notification?.title, "title").toBe("New comment on issue");
  });

  it.each(OTHER_COMMENT_ACTIONS)("ISSUE_COMMENT ignores every other issue_comment action: %j", (action) => {
    const notification = evaluate(variant(created, ["action"], action));

    expect(notification, "notification").toBeUndefined();
  });

  it.each(["issues", "pull_request", "star", ""])(
    "ISSUE_COMMENT ignores its payload under the event name %j",
    (event) => {
      const notification = ISSUE_COMMENT.evaluate(event, created, DEFAULT_SETTINGS, OWNER);

      expect(notification, "notification").toBeUndefined();
    },
  );

  it("ISSUE_COMMENT ignores an issues payload under the issue_comment event name", () => {
    const notification = evaluate(variant(opened, ["action"], "created"));

    expect(notification, "notification").toBeUndefined();
  });

  it.each<EmptyBody>(EMPTY_BODIES)("ISSUE_COMMENT writes line 3 as the author alone for $case", ({ body }) => {
    const notification = evaluate(variant(created, ["comment", "body"], body));

    expect(notification?.context, "line 3").toBe("by example-other-user");
    expect(notification?.title, "the case is still reported").toBe("New comment on issue");
  });

  it("ISSUE_COMMENT reports a comment whose issue has no body", () => {
    const payload = variant(created, ["issue", "body"], null);

    const notification = evaluate(payload);

    expect(notification, "notification").toEqual(EXPECTED);
  });

  it.each<MalformedField>(MALFORMED_ISSUE_FIELDS)(
    "ISSUE_COMMENT reports nothing when $field is $label",
    ({ path, value }) => {
      const notification = evaluate(variant(created, path, value));

      expect(notification, "notification").toBeUndefined();
    },
  );

  it.each<MalformedField>(MALFORMED_COMMENT_FIELDS)(
    "ISSUE_COMMENT reports nothing when $field is $label",
    ({ path, value }) => {
      const notification = evaluate(variant(created, path, value));

      expect(notification, "notification").toBeUndefined();
    },
  );

  it.each<MalformedField>(MALFORMED_SENDERS)(
    "ISSUE_COMMENT reports nothing when $field is $label",
    ({ path, value }) => {
      const notification = evaluate(variant(created, path, value));

      expect(notification, "notification").toBeUndefined();
    },
  );
});
