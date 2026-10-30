import { describe, expect, it } from "vitest";
import prRun from "../../test/fixtures/workflow_run/completed-failure-pull-request.json";
import mainRun from "../../test/fixtures/workflow_run/completed-success-default-branch.json";
import { ABSENT, variant } from "../../test/pull-request";
import { DEFAULT_SETTINGS } from "../settings";
import { CI_FAILED_DEFAULT_BRANCH } from "./ci-failed-default-branch";

const GERMAN = { ...DEFAULT_SETTINGS, language: "de" } as const;
const MAIN_FAILURE = variant(mainRun, ["workflow_run", "conclusion"], "failure");
const EXPECTED = {
  title: "CI failed on main",
  repository: "example-owner/example-repo",
  number: undefined,
  subject: "Build and deploy",
  context: "main · [Docs] Add a security policy (#2)",
  url: "https://github.com/example-owner/example-repo/actions/runs/4000",
};

describe("CI_FAILED_DEFAULT_BRANCH", () => {
  it("CI_FAILED_DEFAULT_BRANCH reports the failure of the real default-branch run in English", () => {
    const notification = CI_FAILED_DEFAULT_BRANCH.evaluate("workflow_run", MAIN_FAILURE, DEFAULT_SETTINGS, undefined);

    expect(CI_FAILED_DEFAULT_BRANCH.id, "id").toBe("ci_failed_default_branch");
    expect(notification, "notification").toEqual(EXPECTED);
    expect(notification?.draftCheck, "draft check").toBeUndefined();
  });

  it("CI_FAILED_DEFAULT_BRANCH reports a timed_out run like a failure", () => {
    const payload = variant(mainRun, ["workflow_run", "conclusion"], "timed_out");

    const notification = CI_FAILED_DEFAULT_BRANCH.evaluate("workflow_run", payload, DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toEqual(EXPECTED);
  });

  it("CI_FAILED_DEFAULT_BRANCH reports in German", () => {
    const notification = CI_FAILED_DEFAULT_BRANCH.evaluate("workflow_run", MAIN_FAILURE, GERMAN, undefined);

    expect(notification, "notification").toEqual({ ...EXPECTED, title: "CI fehlgeschlagen auf main" });
  });

  it.each<unknown>(["success", "cancelled", "skipped", "neutral", "action_required", "stale", "startup_failure", null])(
    "CI_FAILED_DEFAULT_BRANCH reports nothing for the conclusion %s",
    (conclusion) => {
      const payload = variant(mainRun, ["workflow_run", "conclusion"], conclusion);

      const notification = CI_FAILED_DEFAULT_BRANCH.evaluate("workflow_run", payload, DEFAULT_SETTINGS, undefined);

      expect(notification, "notification").toBeUndefined();
    },
  );

  it("CI_FAILED_DEFAULT_BRANCH reports nothing for the real successful run", () => {
    const notification = CI_FAILED_DEFAULT_BRANCH.evaluate("workflow_run", mainRun, DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toBeUndefined();
  });

  it.each(["requested", "in_progress"])("CI_FAILED_DEFAULT_BRANCH reports nothing for the action %s", (action) => {
    const payload = variant(MAIN_FAILURE, ["action"], action);

    const notification = CI_FAILED_DEFAULT_BRANCH.evaluate("workflow_run", payload, DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toBeUndefined();
  });

  it("CI_FAILED_DEFAULT_BRANCH reports nothing for the real pull request run", () => {
    const notification = CI_FAILED_DEFAULT_BRANCH.evaluate("workflow_run", prRun, DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toBeUndefined();
  });

  it("CI_FAILED_DEFAULT_BRANCH reports nothing for another event name", () => {
    const notification = CI_FAILED_DEFAULT_BRANCH.evaluate("pull_request", MAIN_FAILURE, DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toBeUndefined();
  });

  it("CI_FAILED_DEFAULT_BRANCH reports a default-branch failure whose pull_requests holds an entry", () => {
    const payload = variant(MAIN_FAILURE, ["workflow_run", "pull_requests"], prRun.workflow_run.pull_requests);

    const notification = CI_FAILED_DEFAULT_BRANCH.evaluate("workflow_run", payload, DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toEqual(EXPECTED);
  });

  it("CI_FAILED_DEFAULT_BRANCH reports a default-branch failure whose pull_requests holds a malformed entry", () => {
    const payload = variant(MAIN_FAILURE, ["workflow_run", "pull_requests"], [null, { number: "x" }, "y"]);

    const notification = CI_FAILED_DEFAULT_BRANCH.evaluate("workflow_run", payload, DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toEqual(EXPECTED);
  });

  it("CI_FAILED_DEFAULT_BRANCH reports a default-branch failure whose pull_requests is absent", () => {
    const payload = variant(MAIN_FAILURE, ["workflow_run", "pull_requests"], ABSENT);

    const notification = CI_FAILED_DEFAULT_BRANCH.evaluate("workflow_run", payload, DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toEqual(EXPECTED);
  });

  it("CI_FAILED_DEFAULT_BRANCH reports nothing for a fork's run from a branch named like the default branch", () => {
    const payload = variant(MAIN_FAILURE, ["workflow_run", "head_repository", "id"], 9999);

    const notification = CI_FAILED_DEFAULT_BRANCH.evaluate("workflow_run", payload, DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toBeUndefined();
  });

  it("CI_FAILED_DEFAULT_BRANCH reports nothing for a failed run on another branch", () => {
    const payload = variant(MAIN_FAILURE, ["workflow_run", "head_branch"], "feature");

    const notification = CI_FAILED_DEFAULT_BRANCH.evaluate("workflow_run", payload, DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toBeUndefined();
  });
});
