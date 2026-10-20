import { describe, expect, it } from "vitest";
import prRun from "../../test/fixtures/workflow_run/completed-failure-pull-request.json";
import mainRun from "../../test/fixtures/workflow_run/completed-success-default-branch.json";
import { variant } from "../../test/pull-request";
import { DEFAULT_SETTINGS } from "../settings";
import { CI_FAILED_PULL_REQUEST } from "./ci-failed-pull-request";

const GERMAN = { ...DEFAULT_SETTINGS, language: "de" } as const;
const MAIN_FAILURE = variant(mainRun, ["workflow_run", "conclusion"], "failure");
const PULL_REQUEST = { owner: "example-owner", repo: "example-other-repo", number: 296 };
const EXPECTED = {
  title: "CI failed in pull request",
  repository: "example-owner/example-other-repo",
  number: 296,
  subject: "CodeQL",
  context: "test/failing-workflow · Make the check fail",
  url: "https://github.com/example-owner/example-other-repo/actions/runs/4001",
  draftCheck: {
    pullRequest: PULL_REQUEST,
    titleWhenUnknown: "CI failed in pull request (draft status unknown)",
  },
};

describe("CI_FAILED_PULL_REQUEST", () => {
  it("CI_FAILED_PULL_REQUEST reports the real failed pull request run with a draft check of pull request 296", () => {
    const notification = CI_FAILED_PULL_REQUEST.evaluate("workflow_run", prRun, DEFAULT_SETTINGS);

    expect(CI_FAILED_PULL_REQUEST.id, "id").toBe("ci_failed_pull_request");
    expect(notification, "notification").toEqual(EXPECTED);
  });

  it("CI_FAILED_PULL_REQUEST reports a timed_out run like a failure", () => {
    const payload = variant(prRun, ["workflow_run", "conclusion"], "timed_out");

    const notification = CI_FAILED_PULL_REQUEST.evaluate("workflow_run", payload, DEFAULT_SETTINGS);

    expect(notification, "notification").toEqual(EXPECTED);
  });

  it("CI_FAILED_PULL_REQUEST reports in German, its draft check with the German title", () => {
    const notification = CI_FAILED_PULL_REQUEST.evaluate("workflow_run", prRun, GERMAN);

    expect(notification, "notification").toEqual({
      ...EXPECTED,
      title: "CI im Pull Request fehlgeschlagen",
      draftCheck: {
        pullRequest: PULL_REQUEST,
        titleWhenUnknown: "CI im Pull Request fehlgeschlagen (Draft-Status unbekannt)",
      },
    });
  });

  it.each<unknown>(["success", "cancelled", "skipped", "neutral", "action_required", "stale", "startup_failure", null])(
    "CI_FAILED_PULL_REQUEST reports nothing for the conclusion %s",
    (conclusion) => {
      const payload = variant(prRun, ["workflow_run", "conclusion"], conclusion);

      const notification = CI_FAILED_PULL_REQUEST.evaluate("workflow_run", payload, DEFAULT_SETTINGS);

      expect(notification, "notification").toBeUndefined();
    },
  );

  it.each(["requested", "in_progress"])("CI_FAILED_PULL_REQUEST reports nothing for the action %s", (action) => {
    const payload = variant(prRun, ["action"], action);

    const notification = CI_FAILED_PULL_REQUEST.evaluate("workflow_run", payload, DEFAULT_SETTINGS);

    expect(notification, "notification").toBeUndefined();
  });

  it("CI_FAILED_PULL_REQUEST reports nothing for another event name", () => {
    const notification = CI_FAILED_PULL_REQUEST.evaluate("pull_request", prRun, DEFAULT_SETTINGS);

    expect(notification, "notification").toBeUndefined();
  });

  it("CI_FAILED_PULL_REQUEST reports nothing for a failed run off the default branch with empty pull_requests", () => {
    const payload = variant(prRun, ["workflow_run", "pull_requests"], []);

    const notification = CI_FAILED_PULL_REQUEST.evaluate("workflow_run", payload, DEFAULT_SETTINGS);

    expect(notification, "notification").toBeUndefined();
  });

  it("CI_FAILED_PULL_REQUEST reports nothing when every pull_requests entry belongs to another repository", () => {
    const entries = [{ number: 296, base: { repo: { id: 9999 } } }, { number: 7 }];
    const payload = variant(prRun, ["workflow_run", "pull_requests"], entries);

    const notification = CI_FAILED_PULL_REQUEST.evaluate("workflow_run", payload, DEFAULT_SETTINGS);

    expect(notification, "notification").toBeUndefined();
  });

  it("CI_FAILED_PULL_REQUEST uses the first entry of the repository after a foreign entry", () => {
    const entries = [
      { number: 5, base: { repo: { id: 9999 } } },
      { number: 12, base: { repo: { id: 2001 } } },
    ];
    const payload = variant(prRun, ["workflow_run", "pull_requests"], entries);

    const notification = CI_FAILED_PULL_REQUEST.evaluate("workflow_run", payload, DEFAULT_SETTINGS);

    expect(notification?.number, "number").toBe(12);
    expect(notification?.draftCheck?.pullRequest, "pull request to check").toEqual({ ...PULL_REQUEST, number: 12 });
  });

  it("CI_FAILED_PULL_REQUEST reports nothing for a failed default-branch run with an entry of its repository", () => {
    const payload = variant(MAIN_FAILURE, ["workflow_run", "pull_requests"], prRun.workflow_run.pull_requests);

    const notification = CI_FAILED_PULL_REQUEST.evaluate("workflow_run", payload, DEFAULT_SETTINGS);

    expect(notification, "notification").toBeUndefined();
  });

  it("CI_FAILED_PULL_REQUEST reports nothing for the same fork run from a branch named like the default branch", () => {
    const fork = variant(MAIN_FAILURE, ["workflow_run", "head_repository", "id"], 9999);

    const notification = CI_FAILED_PULL_REQUEST.evaluate("workflow_run", fork, DEFAULT_SETTINGS);

    expect(notification, "notification").toBeUndefined();
  });

  it("CI_FAILED_PULL_REQUEST reports a fork-named run with an entry of the repository as the pull request case", () => {
    const fork = variant(MAIN_FAILURE, ["workflow_run", "head_repository", "id"], 9999);
    const payload = variant(fork, ["workflow_run", "pull_requests"], prRun.workflow_run.pull_requests);

    const notification = CI_FAILED_PULL_REQUEST.evaluate("workflow_run", payload, DEFAULT_SETTINGS);

    expect(notification?.number, "number").toBe(296);
  });
});
