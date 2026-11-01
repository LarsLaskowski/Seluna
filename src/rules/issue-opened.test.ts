import { describe, expect, it } from "vitest";
import issueCommentCreated from "../../test/fixtures/issue_comment/created.json";
import pullRequestComment from "../../test/fixtures/issue_comment/created-pull-request.json";
import opened from "../../test/fixtures/issues/opened.json";
import secretCreated from "../../test/fixtures/secret_scanning_alert/created.json";
import {
  EMPTY_BODIES,
  fromBot,
  fromOwner,
  MALFORMED_ISSUE_FIELDS,
  MALFORMED_SENDERS,
  ORGANIZATION_OWNER,
  OTHER_ISSUES_ACTIONS,
  OWNER,
} from "../../test/issue";
import type { EmptyBody, MalformedField } from "../../test/issue";
import { variant } from "../../test/pull-request";
import { DEFAULT_SETTINGS } from "../settings";
import type { WebhookPayload } from "./rule";
import { ISSUE_OPENED } from "./issue-opened";

const GERMAN = { ...DEFAULT_SETTINGS, language: "de" } as const;
const EXPECTED = {
  title: "New issue",
  repository: "example-owner/example-repo",
  number: 7,
  subject: "Example issue from another user",
  context: "by example-other-user · An example issue body written by another user.",
  url: "https://github.com/example-owner/example-repo/issues/7",
};

function evaluate(payload: WebhookPayload): ReturnType<typeof ISSUE_OPENED.evaluate> {
  return ISSUE_OPENED.evaluate("issues", payload, DEFAULT_SETTINGS, OWNER);
}

describe("ISSUE_OPENED", () => {
  it("ISSUE_OPENED reports the opened fixture of another account in English", () => {
    const notification = ISSUE_OPENED.evaluate("issues", opened, DEFAULT_SETTINGS, OWNER);

    expect(ISSUE_OPENED.id, "id").toBe("issue_opened");
    expect(notification, "notification").toEqual(EXPECTED);
    expect(notification?.draftCheck, "draft check").toBeUndefined();
  });

  it("ISSUE_OPENED reports in German", () => {
    const notification = ISSUE_OPENED.evaluate("issues", opened, GERMAN, OWNER);

    expect(notification, "notification").toEqual({
      ...EXPECTED,
      title: "Neues Issue",
      context: "von example-other-user · An example issue body written by another user.",
    });
  });

  it("ISSUE_OPENED names the issue's author on line 3, not the sender", () => {
    const payload = variant(opened, ["issue", "user", "login"], "issue-author");

    const notification = evaluate(payload);

    expect(notification?.context, "line 3").toBe("by issue-author · An example issue body written by another user.");
  });

  it("ISSUE_OPENED ignores the owner's delivery and a bot's", () => {
    const own = evaluate(fromOwner(opened));
    const bot = evaluate(fromBot(opened));

    expect(own, "owner's delivery").toBeUndefined();
    expect(bot, "bot's delivery").toBeUndefined();
  });

  it.each<{ case: string; owner: typeof OWNER | undefined }>([
    { case: "an organization owner", owner: ORGANIZATION_OWNER },
    { case: "an unknown owner", owner: undefined },
  ])("ISSUE_OPENED reports the delivery of the owner's id with $case", ({ owner }) => {
    const notification = ISSUE_OPENED.evaluate("issues", fromOwner(opened), DEFAULT_SETTINGS, owner);

    expect(notification?.title, "title").toBe("New issue");
  });

  it("ISSUE_OPENED ignores a bot's delivery without an owner", () => {
    const notification = ISSUE_OPENED.evaluate("issues", fromBot(opened), DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toBeUndefined();
  });

  it.each(OTHER_ISSUES_ACTIONS)("ISSUE_OPENED ignores every other issues action: %j", (action) => {
    const notification = evaluate(variant(opened, ["action"], action));

    expect(notification, "notification").toBeUndefined();
  });

  it.each(["issue_comment", "pull_request", "star", ""])(
    "ISSUE_OPENED ignores its payload under the event name %j",
    (event) => {
      const notification = ISSUE_OPENED.evaluate(event, opened, DEFAULT_SETTINGS, OWNER);

      expect(notification, "notification").toBeUndefined();
    },
  );

  it.each<{ case: string; payload: WebhookPayload }>([
    { case: "a comment on an issue", payload: issueCommentCreated },
    { case: "a comment on a pull request", payload: pullRequestComment },
    { case: "a secret scanning alert", payload: secretCreated },
    { case: "an empty object", payload: {} },
  ])("ISSUE_OPENED ignores $case under the issues event name", ({ payload }) => {
    const notification = evaluate(variant(payload, ["action"], "opened"));

    expect(notification, "notification").toBeUndefined();
  });

  it("ISSUE_OPENED ignores an issues delivery that names a pull request", () => {
    const payload = variant(opened, ["issue", "pull_request"], { url: "https://api.github.com/repos/x/y/pulls/7" });

    const notification = evaluate(payload);

    expect(notification, "notification").toBeUndefined();
  });

  it.each<EmptyBody>(EMPTY_BODIES)("ISSUE_OPENED writes line 3 as the author alone for $case", ({ body }) => {
    const notification = evaluate(variant(opened, ["issue", "body"], body));

    expect(notification?.context, "line 3").toBe("by example-other-user");
    expect(notification?.title, "the case is still reported").toBe("New issue");
  });

  it("ISSUE_OPENED writes line 3 as the author alone in German for an empty body", () => {
    const notification = ISSUE_OPENED.evaluate("issues", variant(opened, ["issue", "body"], ""), GERMAN, OWNER);

    expect(notification?.context, "line 3").toBe("von example-other-user");
  });

  it("ISSUE_OPENED reports an issue template's body as one line without its HTML comments", () => {
    const body = "<!-- Please describe -->\n## Context\n\nSeluna   sends\t…\n<!-- end";

    const notification = evaluate(variant(opened, ["issue", "body"], body));

    expect(notification?.context, "line 3").toBe("by example-other-user · ## Context Seluna sends …");
  });

  it.each<MalformedField>(MALFORMED_ISSUE_FIELDS)(
    "ISSUE_OPENED reports nothing when $field is $label",
    ({ path, value }) => {
      const notification = evaluate(variant(opened, path, value));

      expect(notification, "notification").toBeUndefined();
    },
  );

  it.each<MalformedField>(MALFORMED_SENDERS)(
    "ISSUE_OPENED reports nothing when $field is $label",
    ({ path, value }) => {
      const notification = evaluate(variant(opened, path, value));

      expect(notification, "notification").toBeUndefined();
    },
  );
});
