import { describe, expect, it } from "vitest";
import opened from "../../test/fixtures/pull_request/opened.json";
import reviewRequested from "../../test/fixtures/pull_request/review_requested.json";
import failedRun from "../../test/fixtures/workflow_run/completed-failure-pull-request.json";
import { ABSENT, variant } from "../../test/pull-request";
import {
  ADMITTED_AUTHOR_ASSOCIATIONS,
  ADMITTED_ONLY_RUN_EVENTS,
  isCountedDelivery,
  isStrangerPullRequest,
  isStrangerRun,
} from "./stranger";
import type { WebhookPayload } from "./rule";
import type { OwnerAccount } from "../github/owner";
import type { BoundedEvent } from "../store/meta";

/** The owner as the pull request fixtures name the sender. */
const PULL_REQUEST_OWNER: OwnerAccount = { id: 1_000_001, login: "example-owner", type: "User" };
/** The owner as the workflow run fixture names the triggering actor. */
const RUN_OWNER: OwnerAccount = { id: 1000, login: "example-owner", type: "User" };
const STRANGER = { id: 777, login: "example-stranger", type: "User" };

const ADMITTED_EVENTS = [
  "push",
  "schedule",
  "merge_group",
  "release",
  "create",
  "delete",
  "page_build",
  "label",
  "milestone",
  "registry_package",
  "branch_protection_rule",
];

/** The real opened delivery, authored by a stranger with the given association and sent by the stranger. */
function strangerPullRequest(association: unknown): WebhookPayload {
  return variant(variant(opened, ["pull_request", "author_association"], association), ["sender"], STRANGER);
}

/** The real failed run with the given event, started by a stranger. */
function strangerRun(event: unknown): WebhookPayload {
  return variant(
    variant(variant(failedRun, ["workflow_run", "event"], event), ["workflow_run", "actor"], STRANGER),
    ["workflow_run", "triggering_actor"],
    STRANGER,
  );
}

describe("constants", () => {
  it("ADMITTED_AUTHOR_ASSOCIATIONS holds exactly OWNER, MEMBER and COLLABORATOR", () => {
    expect(ADMITTED_AUTHOR_ASSOCIATIONS, "associations").toEqual(new Set(["OWNER", "MEMBER", "COLLABORATOR"]));
  });

  it("ADMITTED_ONLY_RUN_EVENTS holds exactly the 11 events only an admitted account can cause", () => {
    expect(ADMITTED_ONLY_RUN_EVENTS, "events").toEqual(new Set(ADMITTED_EVENTS));
  });
});

describe("isCountedDelivery for pull_request", () => {
  it.each<{ value: string; association: unknown }>([
    { value: "CONTRIBUTOR", association: "CONTRIBUTOR" },
    { value: "FIRST_TIMER", association: "FIRST_TIMER" },
    { value: "FIRST_TIME_CONTRIBUTOR", association: "FIRST_TIME_CONTRIBUTOR" },
    { value: "NONE", association: "NONE" },
    { value: "MANNEQUIN", association: "MANNEQUIN" },
    { value: "owner", association: "owner" },
    { value: "Member", association: "Member" },
    { value: "an unknown string", association: "SPONSOR" },
    { value: "an empty string", association: "" },
    { value: "missing", association: ABSENT },
    { value: "1", association: 1 },
    { value: "null", association: null },
  ])("isCountedDelivery counts a pull request whose author association is $value", ({ association }) => {
    const counted = isCountedDelivery("pull_request", strangerPullRequest(association), PULL_REQUEST_OWNER);

    expect(counted, "counted").toBe(true);
  });

  it.each(["OWNER", "MEMBER", "COLLABORATOR"])(
    "isCountedDelivery leaves uncounted a pull request whose author association is %s",
    (association) => {
      const counted = isCountedDelivery("pull_request", strangerPullRequest(association), PULL_REQUEST_OWNER);

      expect(counted, "counted").toBe(false);
    },
  );

  it("isCountedDelivery leaves uncounted an admitted association when the owner is unknown", () => {
    const counted = isCountedDelivery("pull_request", strangerPullRequest("MEMBER"), undefined);

    expect(counted, "counted").toBe(false);
  });

  it("isCountedDelivery counts a NONE pull request from a branch of the repository itself", () => {
    const payload = variant(strangerPullRequest("NONE"), ["pull_request", "head", "repo", "id"], 2_000_001);

    const counted = isCountedDelivery("pull_request", payload, PULL_REQUEST_OWNER);

    expect(counted, "counted").toBe(true);
  });

  it("isCountedDelivery counts a NONE pull request authored by a Bot", () => {
    const payload = variant(strangerPullRequest("NONE"), ["pull_request", "user", "type"], "Bot");

    const counted = isCountedDelivery("pull_request", payload, PULL_REQUEST_OWNER);

    expect(counted, "counted").toBe(true);
  });

  it("isCountedDelivery leaves uncounted a NONE pull request sent by the User owner", () => {
    const payload = variant(opened, ["pull_request", "author_association"], "NONE");

    const counted = isCountedDelivery("pull_request", payload, PULL_REQUEST_OWNER);

    expect(counted, "counted").toBe(false);
  });

  it("isCountedDelivery leaves uncounted the owner's review request on a stranger's pull request", () => {
    const payload = variant(reviewRequested, ["pull_request", "author_association"], "NONE");

    const counted = isCountedDelivery("pull_request", payload, PULL_REQUEST_OWNER);

    expect(counted, "counted").toBe(false);
  });

  it("isCountedDelivery counts a NONE pull request sent by the account of an Organization owner", () => {
    const organization: OwnerAccount = { ...PULL_REQUEST_OWNER, type: "Organization" };
    const payload = variant(opened, ["pull_request", "author_association"], "NONE");

    const counted = isCountedDelivery("pull_request", payload, organization);

    expect(counted, "counted").toBe(true);
  });

  it("isCountedDelivery counts a NONE pull request sent by the owner when no owner is stored", () => {
    const payload = variant(opened, ["pull_request", "author_association"], "NONE");

    const counted = isCountedDelivery("pull_request", payload, undefined);

    expect(counted, "counted").toBe(true);
  });

  it.each<{ case: string; payload: WebhookPayload }>([
    { case: "pull_request absent", payload: variant(opened, ["pull_request"], ABSENT) },
    { case: "pull_request null", payload: variant(opened, ["pull_request"], null) },
    { case: "pull_request an array", payload: variant(opened, ["pull_request"], []) },
    { case: "an empty payload", payload: {} },
  ])("isCountedDelivery counts a pull request delivery with $case", ({ payload }) => {
    const counted = isCountedDelivery("pull_request", payload, PULL_REQUEST_OWNER);

    expect(counted, "counted").toBe(true);
  });
});

describe("isStrangerPullRequest", () => {
  it("isStrangerPullRequest is true for a NONE pull request of another sender", () => {
    expect(isStrangerPullRequest(strangerPullRequest("NONE"), PULL_REQUEST_OWNER), "stranger").toBe(true);
  });

  it("isStrangerPullRequest is false for a MEMBER pull request", () => {
    expect(isStrangerPullRequest(strangerPullRequest("MEMBER"), PULL_REQUEST_OWNER), "stranger").toBe(false);
  });
});

describe("isCountedDelivery for workflow_run", () => {
  it.each(ADMITTED_EVENTS)("isCountedDelivery leaves uncounted a failed run of event %s", (event) => {
    const counted = isCountedDelivery("workflow_run", strangerRun(event), RUN_OWNER);

    expect(counted, "counted").toBe(false);
  });

  it.each(ADMITTED_EVENTS)(
    "isCountedDelivery leaves uncounted a failed run of event %s when the owner is unknown",
    (event) => {
      const counted = isCountedDelivery("workflow_run", strangerRun(event), undefined);

      expect(counted, "counted").toBe(false);
    },
  );

  it("isCountedDelivery leaves uncounted a stranger's issue_comment run re-run by the owner", () => {
    const payload = variant(strangerRun("issue_comment"), ["workflow_run", "triggering_actor"], RUN_OWNER);

    const counted = isCountedDelivery("workflow_run", payload, RUN_OWNER);

    expect(counted, "counted").toBe(false);
  });

  it("isCountedDelivery leaves uncounted a workflow_dispatch run started by the owner", () => {
    const payload = variant(failedRun, ["workflow_run", "event"], "workflow_dispatch");

    const counted = isCountedDelivery("workflow_run", payload, RUN_OWNER);

    expect(counted, "counted").toBe(false);
  });

  it.each([
    "pull_request_target",
    "issue_comment",
    "issues",
    "workflow_dispatch",
    "repository_dispatch",
    "status",
    "deployment_status",
    "check_suite",
    "dynamic",
    "workflow_run",
    "gollum",
    "pull_request",
    "an-unknown-event",
    "Push",
    "",
  ])("isCountedDelivery counts a failed run of event %s", (event) => {
    const counted = isCountedDelivery("workflow_run", strangerRun(event), RUN_OWNER);

    expect(counted, "counted").toBe(true);
  });

  it.each<{ case: string; event: unknown }>([
    { case: "missing", event: ABSENT },
    { case: "the number 7", event: 7 },
    { case: "null", event: null },
    { case: "an array", event: ["push"] },
  ])("isCountedDelivery counts a failed run whose event is $case", ({ event }) => {
    const counted = isCountedDelivery("workflow_run", strangerRun(event), RUN_OWNER);

    expect(counted, "counted").toBe(true);
  });

  it("isCountedDelivery counts a pull_request run from a branch of the repository itself re-run by a stranger", () => {
    const payload = variant(
      variant(failedRun, ["workflow_run", "triggering_actor"], STRANGER),
      ["workflow_run", "head_repository", "id"],
      2001,
    );

    const counted = isCountedDelivery("workflow_run", payload, RUN_OWNER);

    expect(counted, "counted").toBe(true);
  });

  it("isCountedDelivery counts a pull_request run from a fork", () => {
    const payload = variant(strangerRun("pull_request"), ["workflow_run", "head_repository", "id"], 999_999);

    const counted = isCountedDelivery("workflow_run", payload, RUN_OWNER);

    expect(counted, "counted").toBe(true);
  });

  it("isCountedDelivery counts a run whose actor is the owner and whose triggering_actor is a stranger", () => {
    const payload = variant(failedRun, ["workflow_run", "triggering_actor"], STRANGER);

    const counted = isCountedDelivery("workflow_run", payload, RUN_OWNER);

    expect(counted, "counted").toBe(true);
  });

  it.each<{ case: string; value: unknown }>([
    { case: "missing", value: ABSENT },
    { case: "null", value: null },
    { case: "a string", value: "1000" },
    { case: "an array", value: [RUN_OWNER] },
    { case: "an id that is a string", value: { id: "1000", type: "User" } },
  ])("isCountedDelivery counts a pull_request run whose triggering_actor is $case", ({ value }) => {
    const payload = variant(failedRun, ["workflow_run", "triggering_actor"], value);

    const counted = isCountedDelivery("workflow_run", payload, RUN_OWNER);

    expect(counted, "counted").toBe(true);
  });

  it("isCountedDelivery counts an owner-triggered run under an Organization owner", () => {
    const organization: OwnerAccount = { ...RUN_OWNER, type: "Organization" };

    const counted = isCountedDelivery("workflow_run", failedRun, organization);

    expect(counted, "counted").toBe(true);
  });

  it("isCountedDelivery counts an owner-triggered run when no owner is stored", () => {
    const counted = isCountedDelivery("workflow_run", failedRun, undefined);

    expect(counted, "counted").toBe(true);
  });

  it.each<{ case: string; payload: WebhookPayload }>([
    { case: "workflow_run absent", payload: variant(failedRun, ["workflow_run"], ABSENT) },
    { case: "workflow_run null", payload: variant(failedRun, ["workflow_run"], null) },
    { case: "workflow_run an array", payload: variant(failedRun, ["workflow_run"], []) },
    { case: "an empty payload", payload: {} },
  ])("isCountedDelivery counts a run delivery with $case", ({ payload }) => {
    const counted = isCountedDelivery("workflow_run", payload, RUN_OWNER);

    expect(counted, "counted").toBe(true);
  });
});

describe("isStrangerRun", () => {
  it("isStrangerRun is true for a stranger's issue_comment run", () => {
    expect(isStrangerRun(strangerRun("issue_comment"), RUN_OWNER), "stranger").toBe(true);
  });

  it("isStrangerRun is false for a push run", () => {
    expect(isStrangerRun(strangerRun("push"), RUN_OWNER), "stranger").toBe(false);
  });
});

describe("isCountedDelivery for the other bounded events", () => {
  it.each<BoundedEvent>(["issues", "issue_comment", "star", "fork"])(
    "isCountedDelivery counts a delivery of %s whoever sent it",
    (event) => {
      expect(isCountedDelivery(event, opened, PULL_REQUEST_OWNER), "counted").toBe(true);
    },
  );
});
