import { describe, expect, it } from "vitest";
import forkFixture from "../../test/fixtures/fork/fork.json";
import starCreated from "../../test/fixtures/star/created.json";
import { MALFORMED_ACTIVITY_FIELDS, STAR_COUNTS } from "../../test/activity";
import { fromBot, fromOwner, MALFORMED_SENDERS, ORGANIZATION_OWNER, OWNER } from "../../test/issue";
import { ABSENT, variant } from "../../test/pull-request";
import { activityRepositoryOf, foreignActorOf } from "./activity";

describe("foreignActorOf", () => {
  it.each([
    { case: "a star", payload: starCreated },
    { case: "a fork", payload: forkFixture },
  ])("foreignActorOf returns the id and login of the sender of $case", ({ payload }) => {
    const actor = foreignActorOf(payload, OWNER);

    expect(actor, "actor").toEqual({ id: 1_000_002, login: "example-other-user" });
  });

  it("foreignActorOf takes the login of the sender, not of the forkee's owner", () => {
    const payload = variant(forkFixture, ["forkee", "owner", "login"], "someone-else");

    const actor = foreignActorOf(payload, OWNER);

    expect(actor?.login, "login").toBe("example-other-user");
  });

  it("foreignActorOf returns undefined for the owner and for a bot", () => {
    expect(foreignActorOf(fromOwner(starCreated), OWNER), "owner").toBeUndefined();
    expect(foreignActorOf(fromBot(starCreated), OWNER), "bot").toBeUndefined();
    expect(foreignActorOf(fromBot(starCreated), undefined), "bot without an owner").toBeUndefined();
  });

  it.each([
    { case: "an organization owner", owner: ORGANIZATION_OWNER },
    { case: "an unknown owner", owner: undefined },
  ])("foreignActorOf counts the sender with the owner's id as foreign for $case", ({ owner }) => {
    const actor = foreignActorOf(fromOwner(starCreated), owner);

    expect(actor, "actor").toEqual({ id: 1000, login: "example-owner" });
  });

  it.each(MALFORMED_SENDERS)("foreignActorOf returns undefined for $field that is $label", ({ path, value }) => {
    const actor = foreignActorOf(variant(starCreated, path, value), OWNER);

    expect(actor, "actor").toBeUndefined();
  });

  it.each(MALFORMED_ACTIVITY_FIELDS.filter(({ field }) => field === "sender.login"))(
    "foreignActorOf returns undefined for a sender.login that is $label",
    ({ path, value }) => {
      const actor = foreignActorOf(variant(starCreated, path, value), OWNER);

      expect(actor, "actor").toBeUndefined();
    },
  );
});

describe("activityRepositoryOf", () => {
  it.each([
    { case: "a star", payload: starCreated },
    { case: "a fork", payload: forkFixture },
  ])("activityRepositoryOf returns id, name, URL and star count of the repository of $case", ({ payload }) => {
    const repository = activityRepositoryOf(payload);

    expect(repository, "repository").toEqual({
      id: 2000,
      fullName: "example-owner/example-repo",
      url: "https://github.com/example-owner/example-repo",
      starCount: 0,
    });
  });

  it.each(STAR_COUNTS)("activityRepositoryOf reads the star count $case as $expected", ({ value, expected }) => {
    const repository = activityRepositoryOf(variant(starCreated, ["repository", "stargazers_count"], value));

    expect(repository?.starCount, "star count").toBe(expected);
    expect(repository?.fullName, "the repository is still usable").toBe("example-owner/example-repo");
  });

  it.each([
    { case: "missing", value: undefined },
    { case: "a number", value: 7 },
    { case: "null", value: null },
  ])("activityRepositoryOf gives an empty URL when html_url is $case", ({ value }) => {
    const payload = variant(starCreated, ["repository", "html_url"], value === undefined ? ABSENT : value);

    const repository = activityRepositoryOf(payload);

    expect(repository?.url, "URL").toBe("");
    expect(repository?.id, "the repository is still usable").toBe(2000);
  });

  it.each(MALFORMED_ACTIVITY_FIELDS.filter(({ field }) => field.startsWith("repository")))(
    "activityRepositoryOf returns undefined for $field that is $label",
    ({ path, value }) => {
      const repository = activityRepositoryOf(variant(starCreated, path, value));

      expect(repository, "repository").toBeUndefined();
    },
  );
});
