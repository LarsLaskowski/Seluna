import { describe, expect, it } from "vitest";
import forkFixture from "../../test/fixtures/fork/fork.json";
import { MALFORMED_ACTIVITY_FIELDS, MALFORMED_FORKEE_FIELDS } from "../../test/activity";
import { fromBot, fromOwner, MALFORMED_SENDERS, ORGANIZATION_OWNER, OWNER } from "../../test/issue";
import { ABSENT, variant } from "../../test/pull-request";
import { DEFAULT_SETTINGS } from "../settings";
import { REPOSITORY_FORKED } from "./repository-forked";
import type { WebhookPayload } from "./rule";

const GERMAN = { ...DEFAULT_SETTINGS, language: "de" } as const;
const EXPECTED = {
  title: "New fork",
  repository: "example-owner/example-repo",
  number: undefined,
  subject: "example-other-user/example-repo",
  context: "by example-other-user",
  url: "https://github.com/example-other-user/example-repo",
  activity: {
    kind: "fork",
    senderId: 1_000_002,
    senderLogin: "example-other-user",
    repositoryId: 2000,
    repository: "example-owner/example-repo",
    repositoryUrl: "https://github.com/example-owner/example-repo",
    starCount: undefined,
  },
};

function evaluate(payload: WebhookPayload): ReturnType<typeof REPOSITORY_FORKED.evaluate> {
  return REPOSITORY_FORKED.evaluate("fork", payload, DEFAULT_SETTINGS, OWNER);
}

describe("REPOSITORY_FORKED", () => {
  it("REPOSITORY_FORKED reports the fork fixture of another account in English with the activity set", () => {
    const notification = REPOSITORY_FORKED.evaluate("fork", forkFixture, DEFAULT_SETTINGS, OWNER);

    expect(REPOSITORY_FORKED.id, "id").toBe("repository_forked");
    expect(notification, "notification").toEqual(EXPECTED);
  });

  it("REPOSITORY_FORKED reports in German", () => {
    const notification = REPOSITORY_FORKED.evaluate("fork", forkFixture, GERMAN, OWNER);

    expect(notification, "notification").toEqual({
      ...EXPECTED,
      title: "Neuer Fork",
      context: "von example-other-user",
    });
  });

  it("REPOSITORY_FORKED names the sender's login, not the owner of the fork", () => {
    const payload = variant(forkFixture, ["forkee", "owner", "login"], "someone-else");

    const notification = evaluate(payload);

    expect(notification?.context, "line 3").toBe("by example-other-user");
    expect(notification?.activity?.senderLogin, "login of the activity").toBe("example-other-user");
  });

  it("REPOSITORY_FORKED shows the fork's name on line 2 and opens the fork", () => {
    const payload = variant(
      variant(forkFixture, ["forkee", "full_name"], "example-other-user/renamed"),
      ["forkee", "html_url"],
      "https://github.com/example-other-user/renamed",
    );

    const notification = evaluate(payload);

    expect(notification?.subject, "line 2").toBe("example-other-user/renamed");
    expect(notification?.url, "button target").toBe("https://github.com/example-other-user/renamed");
    expect(notification?.activity?.repositoryUrl, "digest button target is the repository").toBe(
      "https://github.com/example-owner/example-repo",
    );
  });

  it("REPOSITORY_FORKED never carries a star count, whatever the repository says", () => {
    const payload = variant(forkFixture, ["repository", "stargazers_count"], 1234);

    const notification = evaluate(payload);

    expect(notification?.activity?.starCount, "star count").toBeUndefined();
    expect(notification?.context, "line 3 is the sender only").toBe("by example-other-user");
  });

  it("REPOSITORY_FORKED ignores the owner's fork and a bot's", () => {
    expect(evaluate(fromOwner(forkFixture)), "owner").toBeUndefined();
    expect(evaluate(fromBot(forkFixture)), "bot").toBeUndefined();
  });

  it.each<{ case: string; owner: typeof OWNER | undefined }>([
    { case: "an organization owner", owner: ORGANIZATION_OWNER },
    { case: "an unknown owner", owner: undefined },
  ])("REPOSITORY_FORKED reports the fork of the owner's id with $case", ({ owner }) => {
    const notification = REPOSITORY_FORKED.evaluate("fork", fromOwner(forkFixture), DEFAULT_SETTINGS, owner);

    expect(notification?.title, "title").toBe("New fork");
    expect(notification?.activity?.senderId, "sender id").toBe(1000);
  });

  it("REPOSITORY_FORKED ignores other events with the fork payload", () => {
    for (const event of ["star", "issues", "FORK", ""]) {
      expect(REPOSITORY_FORKED.evaluate(event, forkFixture, DEFAULT_SETTINGS, OWNER), `event ${event}`).toBeUndefined();
    }
  });

  it.each(["created", "deleted", ""].map((action) => ({ action })))(
    "REPOSITORY_FORKED ignores a delivery with the action '$action'",
    ({ action }) => {
      expect(evaluate(variant(forkFixture, ["action"], action)), "notification").toBeUndefined();
    },
  );

  it("REPOSITORY_FORKED accepts the fixture without an action key", () => {
    expect(evaluate(variant(forkFixture, ["action"], ABSENT)), "notification").toBeDefined();
  });

  it.each(MALFORMED_SENDERS)("REPOSITORY_FORKED ignores $field that is $label", ({ path, value }) => {
    expect(evaluate(variant(forkFixture, path, value)), "notification").toBeUndefined();
  });

  it.each(MALFORMED_ACTIVITY_FIELDS)("REPOSITORY_FORKED ignores $field that is $label", ({ path, value }) => {
    expect(evaluate(variant(forkFixture, path, value)), "notification").toBeUndefined();
  });

  it.each(MALFORMED_FORKEE_FIELDS)("REPOSITORY_FORKED ignores $field that is $label", ({ path, value }) => {
    expect(evaluate(variant(forkFixture, path, value)), "notification").toBeUndefined();
  });
});
