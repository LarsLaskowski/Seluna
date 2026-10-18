import { describe, expect, it } from "vitest";
import opened from "../../test/fixtures/pull_request/opened.json";
import openedDraft from "../../test/fixtures/pull_request/opened-draft.json";
import { ABSENT, variant } from "../../test/pull-request";
import { nonDraftPullRequest } from "./pull-request";
import type { PullRequestAction } from "./pull-request";
import type { WebhookPayload } from "./rule";

const OPENED_FIELDS = {
  repository: "example-owner/example-other-repo",
  number: 143,
  title: "[Docs] Update the contributor documentation",
  url: "https://github.com/example-owner/example-other-repo/pull/143",
  author: "example-owner",
  head: "claude/example-branch",
  base: "main",
};

describe("nonDraftPullRequest", () => {
  it("nonDraftPullRequest returns the fields of the real opened delivery", () => {
    const fields = nonDraftPullRequest("pull_request", opened, "opened");

    expect(fields, "fields").toEqual(OPENED_FIELDS);
  });

  it.each(["issues", "pull_request_review", "ping"])(
    "nonDraftPullRequest returns undefined for the event %s",
    (event) => {
      const fields = nonDraftPullRequest(event, opened, "opened");

      expect(fields, "fields").toBeUndefined();
    },
  );

  it.each<{ case: string; action: PullRequestAction; payload: WebhookPayload }>([
    { case: "ready_for_review in a request for opened", action: "ready_for_review", payload: opened },
    { case: "opened in a request for review_requested", action: "review_requested", payload: opened },
    { case: "absent", action: "opened", payload: variant(opened, ["action"], ABSENT) },
    { case: "the number 1", action: "opened", payload: variant(opened, ["action"], 1) },
  ])("nonDraftPullRequest returns undefined when the action is $case", ({ action, payload }) => {
    const fields = nonDraftPullRequest("pull_request", payload, action);

    expect(fields, "fields").toBeUndefined();
  });

  it.each<{ case: string; payload: WebhookPayload }>([
    { case: "true (the real draft delivery)", payload: openedDraft },
    { case: "absent", payload: variant(opened, ["pull_request", "draft"], ABSENT) },
    { case: "null", payload: variant(opened, ["pull_request", "draft"], null) },
    { case: 'the string "false"', payload: variant(opened, ["pull_request", "draft"], "false") },
    { case: "the number 0", payload: variant(opened, ["pull_request", "draft"], 0) },
  ])("nonDraftPullRequest returns undefined when draft is $case", ({ payload }) => {
    const fields = nonDraftPullRequest("pull_request", payload, "opened");

    expect(fields, "fields").toBeUndefined();
  });

  it.each<{ case: string; path: readonly string[]; value: unknown }>([
    { case: "pull_request is absent", path: ["pull_request"], value: ABSENT },
    { case: "pull_request is null", path: ["pull_request"], value: null },
    { case: "pull_request is an array", path: ["pull_request"], value: [] },
    { case: "pull_request.number is 0", path: ["pull_request", "number"], value: 0 },
    { case: "pull_request.number is -1", path: ["pull_request", "number"], value: -1 },
    { case: "pull_request.number is 1.5", path: ["pull_request", "number"], value: 1.5 },
    { case: "pull_request.number is 2 ** 53", path: ["pull_request", "number"], value: 2 ** 53 },
    { case: "pull_request.number is a string", path: ["pull_request", "number"], value: "143" },
    { case: "pull_request.number is Infinity", path: ["pull_request", "number"], value: Infinity },
    { case: "pull_request.title is absent", path: ["pull_request", "title"], value: ABSENT },
    { case: "pull_request.title is a number", path: ["pull_request", "title"], value: 1 },
    { case: "pull_request.title is an array", path: ["pull_request", "title"], value: [] },
    { case: "pull_request.html_url is absent", path: ["pull_request", "html_url"], value: ABSENT },
    { case: "pull_request.html_url is a number", path: ["pull_request", "html_url"], value: 1 },
    { case: "pull_request.user is null", path: ["pull_request", "user"], value: null },
    { case: "pull_request.user.login is absent", path: ["pull_request", "user", "login"], value: ABSENT },
    { case: "pull_request.user.login is a number", path: ["pull_request", "user", "login"], value: 1 },
    { case: "pull_request.head is null", path: ["pull_request", "head"], value: null },
    { case: "pull_request.head.ref is absent", path: ["pull_request", "head", "ref"], value: ABSENT },
    { case: "pull_request.head.ref is a number", path: ["pull_request", "head", "ref"], value: 1 },
    { case: "pull_request.head.ref is an object", path: ["pull_request", "head", "ref"], value: {} },
    { case: "pull_request.base is null", path: ["pull_request", "base"], value: null },
    { case: "pull_request.base.ref is absent", path: ["pull_request", "base", "ref"], value: ABSENT },
    { case: "pull_request.base.ref is a number", path: ["pull_request", "base", "ref"], value: 1 },
    { case: "repository is absent", path: ["repository"], value: ABSENT },
    { case: "repository is null", path: ["repository"], value: null },
    { case: "repository.full_name is absent", path: ["repository", "full_name"], value: ABSENT },
    { case: "repository.full_name is a number", path: ["repository", "full_name"], value: 1 },
  ])("nonDraftPullRequest returns undefined when $case", ({ path, value }) => {
    const payload = variant(opened, path, value);

    const fields = nonDraftPullRequest("pull_request", payload, "opened");

    expect(fields, "fields").toBeUndefined();
  });

  it("nonDraftPullRequest ignores head.repo and sender", () => {
    const payload = variant(variant(opened, ["pull_request", "head", "repo"], null), ["sender"], ABSENT);

    const fields = nonDraftPullRequest("pull_request", payload, "opened");

    expect(fields, "fields").toEqual(OPENED_FIELDS);
  });
});
