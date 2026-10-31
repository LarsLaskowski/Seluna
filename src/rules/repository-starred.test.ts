import { describe, expect, it } from "vitest";
import starCreated from "../../test/fixtures/star/created.json";
import starDeleted from "../../test/fixtures/star/deleted.json";
import { MALFORMED_ACTIVITY_FIELDS, OTHER_STAR_ACTIONS, STAR_COUNTS } from "../../test/activity";
import { fromBot, fromOwner, MALFORMED_SENDERS, ORGANIZATION_OWNER, OWNER } from "../../test/issue";
import { ABSENT, variant } from "../../test/pull-request";
import { DEFAULT_SETTINGS } from "../settings";
import type { NotificationSettings } from "../settings";
import { REPOSITORY_STARRED, starRemovalOf } from "./repository-starred";
import type { WebhookPayload } from "./rule";

const GERMAN = { ...DEFAULT_SETTINGS, language: "de" } as const;
const ACTIVITY = {
  kind: "star",
  senderId: 1_000_002,
  senderLogin: "example-other-user",
  repositoryId: 2000,
  repository: "example-owner/example-repo",
  repositoryUrl: "https://github.com/example-owner/example-repo",
  starCount: 0,
} as const;
const EXPECTED = {
  title: "New star",
  repository: "example-owner/example-repo",
  number: undefined,
  subject: "by example-other-user",
  context: "0 stars now",
  url: "https://github.com/example-owner/example-repo",
  activity: ACTIVITY,
};
const SWITCH_ON: NotificationSettings = {
  ...DEFAULT_SETTINGS,
  rules: { ...DEFAULT_SETTINGS.rules, repository_starred: true },
};

function evaluate(payload: WebhookPayload): ReturnType<typeof REPOSITORY_STARRED.evaluate> {
  return REPOSITORY_STARRED.evaluate("star", payload, DEFAULT_SETTINGS, OWNER);
}

function removal(payload: WebhookPayload): ReturnType<typeof starRemovalOf> {
  return starRemovalOf("star", payload, SWITCH_ON, OWNER);
}

describe("REPOSITORY_STARRED", () => {
  it("REPOSITORY_STARRED reports the created fixture of another account in English with the activity set", () => {
    const notification = REPOSITORY_STARRED.evaluate("star", starCreated, DEFAULT_SETTINGS, OWNER);

    expect(REPOSITORY_STARRED.id, "id").toBe("repository_starred");
    expect(notification, "notification").toEqual(EXPECTED);
  });

  it("REPOSITORY_STARRED reports in German", () => {
    const notification = REPOSITORY_STARRED.evaluate("star", starCreated, GERMAN, OWNER);

    expect(notification, "notification").toEqual({
      ...EXPECTED,
      title: "Neuer Stern",
      subject: "von example-other-user",
      context: "jetzt 0 Sterne",
    });
  });

  it.each([
    { language: "en", count: 1, context: "1 star now" },
    { language: "en", count: 1234, context: "1,234 stars now" },
    { language: "de", count: 1, context: "jetzt 1 Stern" },
    { language: "de", count: 1234, context: "jetzt 1.234 Sterne" },
  ] as const)("REPOSITORY_STARRED writes line 3 for $count stars in $language", ({ language, count, context }) => {
    const payload = variant(starCreated, ["repository", "stargazers_count"], count);

    const notification = REPOSITORY_STARRED.evaluate("star", payload, { ...DEFAULT_SETTINGS, language }, OWNER);

    expect(notification?.context, "line 3").toBe(context);
    expect(notification?.activity?.starCount, "star count of the activity").toBe(count);
  });

  it.each(STAR_COUNTS.filter(({ expected }) => expected === undefined))(
    "REPOSITORY_STARRED leaves out line 3 and the count for the star count $case",
    ({ value }) => {
      const payload = variant(starCreated, ["repository", "stargazers_count"], value);

      const notification = evaluate(payload);

      expect(notification?.context, "line 3").toBe("");
      expect(notification?.activity?.starCount, "star count of the activity").toBeUndefined();
      expect(notification?.subject, "line 2 stays").toBe("by example-other-user");
    },
  );

  it("REPOSITORY_STARRED groups the largest usable count", () => {
    const payload = variant(starCreated, ["repository", "stargazers_count"], Number.MAX_SAFE_INTEGER);

    const notification = evaluate(payload);

    expect(notification?.context, "line 3").toBe("9,007,199,254,740,991 stars now");
  });

  it("REPOSITORY_STARRED names the sender's login on line 2", () => {
    const payload = variant(starCreated, ["sender", "login"], "another-user");

    const notification = evaluate(payload);

    expect(notification?.subject, "line 2").toBe("by another-user");
    expect(notification?.activity?.senderLogin, "login of the activity").toBe("another-user");
  });

  it("REPOSITORY_STARRED gives an empty URL when the repository has no html_url", () => {
    const notification = evaluate(variant(starCreated, ["repository", "html_url"], ABSENT));

    expect(notification?.url, "url").toBe("");
    expect(notification?.activity?.repositoryUrl, "url of the activity").toBe("");
  });

  it("REPOSITORY_STARRED ignores the owner's star and a bot's", () => {
    expect(evaluate(fromOwner(starCreated)), "owner").toBeUndefined();
    expect(evaluate(fromBot(starCreated)), "bot").toBeUndefined();
  });

  it.each<{ case: string; owner: typeof OWNER | undefined }>([
    { case: "an organization owner", owner: ORGANIZATION_OWNER },
    { case: "an unknown owner", owner: undefined },
  ])("REPOSITORY_STARRED reports the star of the owner's id with $case", ({ owner }) => {
    const notification = REPOSITORY_STARRED.evaluate("star", fromOwner(starCreated), DEFAULT_SETTINGS, owner);

    expect(notification?.title, "title").toBe("New star");
    expect(notification?.activity?.senderId, "sender id").toBe(1000);
  });

  it("REPOSITORY_STARRED ignores a bot's star without an owner", () => {
    const notification = REPOSITORY_STARRED.evaluate("star", fromBot(starCreated), DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toBeUndefined();
  });

  it("REPOSITORY_STARRED ignores other events with the star payload", () => {
    for (const event of ["fork", "issues", "star_created", "STAR", ""]) {
      const notification = REPOSITORY_STARRED.evaluate(event, starCreated, DEFAULT_SETTINGS, OWNER);

      expect(notification, `event ${event}`).toBeUndefined();
    }
  });

  it("REPOSITORY_STARRED ignores a star taken back", () => {
    expect(evaluate(starDeleted), "deleted fixture").toBeUndefined();
  });

  it.each([...OTHER_STAR_ACTIONS, "deleted"].map((action) => ({ action })))(
    "REPOSITORY_STARRED ignores the action '$action'",
    ({ action }) => {
      expect(evaluate(variant(starCreated, ["action"], action)), "notification").toBeUndefined();
    },
  );

  it("REPOSITORY_STARRED ignores a star without an action", () => {
    expect(evaluate(variant(starCreated, ["action"], ABSENT)), "notification").toBeUndefined();
  });

  it.each(MALFORMED_SENDERS)("REPOSITORY_STARRED ignores $field that is $label", ({ path, value }) => {
    expect(evaluate(variant(starCreated, path, value)), "notification").toBeUndefined();
  });

  it.each(MALFORMED_ACTIVITY_FIELDS)("REPOSITORY_STARRED ignores $field that is $label", ({ path, value }) => {
    expect(evaluate(variant(starCreated, path, value)), "notification").toBeUndefined();
  });
});

describe("starRemovalOf", () => {
  it("starRemovalOf returns the account and the repository of the deleted fixture when the switch is on", () => {
    const result = starRemovalOf("star", starDeleted, SWITCH_ON, OWNER);

    expect(result, "removal").toEqual({ senderId: 1_000_002, repositoryId: 2000 });
  });

  it("starRemovalOf returns undefined when the switch is off", () => {
    const result = starRemovalOf("star", starDeleted, DEFAULT_SETTINGS, OWNER);

    expect(result, "removal").toBeUndefined();
  });

  it("starRemovalOf is not changed by the language", () => {
    const result = starRemovalOf("star", starDeleted, { ...SWITCH_ON, language: "de" }, OWNER);

    expect(result, "removal").toEqual({ senderId: 1_000_002, repositoryId: 2000 });
  });

  it("starRemovalOf returns undefined for the owner and for a bot", () => {
    expect(removal(fromOwner(starDeleted)), "owner").toBeUndefined();
    expect(removal(fromBot(starDeleted)), "bot").toBeUndefined();
  });

  it.each<{ case: string; owner: typeof OWNER | undefined }>([
    { case: "an organization owner", owner: ORGANIZATION_OWNER },
    { case: "an unknown owner", owner: undefined },
  ])("starRemovalOf removes the stars of the owner's id with $case", ({ owner }) => {
    const result = starRemovalOf("star", fromOwner(starDeleted), SWITCH_ON, owner);

    expect(result, "removal").toEqual({ senderId: 1000, repositoryId: 2000 });
  });

  it("starRemovalOf returns undefined for a created star and for other events", () => {
    expect(removal(starCreated), "created fixture").toBeUndefined();
    for (const event of ["fork", "issues", "STAR", ""]) {
      expect(starRemovalOf(event, starDeleted, SWITCH_ON, OWNER), `event ${event}`).toBeUndefined();
    }
  });

  it.each(
    [...OTHER_STAR_ACTIONS.filter((action) => action !== "Deleted"), "created", "Deleted"].map((action) => ({
      action,
    })),
  )("starRemovalOf returns undefined for the action '$action'", ({ action }) => {
    expect(removal(variant(starDeleted, ["action"], action)), "removal").toBeUndefined();
  });

  it.each(MALFORMED_SENDERS)("starRemovalOf returns undefined for $field that is $label", ({ path, value }) => {
    expect(removal(variant(starDeleted, path, value)), "removal").toBeUndefined();
  });

  it.each(
    MALFORMED_ACTIVITY_FIELDS.filter(({ field }) => ["repository", "repository.id", "sender.login"].includes(field)),
  )("starRemovalOf returns undefined for $field that is $label", ({ path, value }) => {
    expect(removal(variant(starDeleted, path, value)), "removal").toBeUndefined();
  });
});
