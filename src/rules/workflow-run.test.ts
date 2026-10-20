import { describe, expect, it } from "vitest";
import prRun from "../../test/fixtures/workflow_run/completed-failure-pull-request.json";
import mainRun from "../../test/fixtures/workflow_run/completed-success-default-branch.json";
import pullRequestOpened from "../../test/fixtures/pull_request/opened.json";
import { ABSENT, variant } from "../../test/pull-request";
import { failedWorkflowRun, firstCommitLine, pullRequestNumberOf, pullRequestRefOf } from "./workflow-run";

const REPOSITORY_ID = 2001;
const MAIN_FAILURE = variant(mainRun, ["workflow_run", "conclusion"], "failure");

/** A `pull_requests` entry of the repository 2001 that counts. */
const VALID_ENTRY = { number: 296, base: { repo: { id: REPOSITORY_ID } } };

describe("failedWorkflowRun", () => {
  it("failedWorkflowRun returns the fields of the real failed pull request run", () => {
    const run = failedWorkflowRun("workflow_run", prRun);

    expect(run, "run").toEqual({
      repository: "example-owner/example-other-repo",
      branch: "test/failing-workflow",
      onDefaultBranch: false,
      workflow: "CodeQL",
      url: "https://github.com/example-owner/example-other-repo/actions/runs/4001",
      context: "test/failing-workflow · Make the check fail",
      pullRequestNumber: 296,
    });
  });

  it("failedWorkflowRun returns the fields of a failed run on the default branch", () => {
    const run = failedWorkflowRun("workflow_run", MAIN_FAILURE);

    expect(run, "run").toEqual({
      repository: "example-owner/example-repo",
      branch: "main",
      onDefaultBranch: true,
      workflow: "Build and deploy",
      url: "https://github.com/example-owner/example-repo/actions/runs/4000",
      context: "main · [Docs] Add a security policy (#2)",
      pullRequestNumber: undefined,
    });
  });

  it.each(["failure", "timed_out"])("failedWorkflowRun accepts the conclusion %s", (conclusion) => {
    const run = failedWorkflowRun("workflow_run", variant(mainRun, ["workflow_run", "conclusion"], conclusion));

    expect(run?.onDefaultBranch, "on the default branch").toBe(true);
  });

  it.each<unknown>([
    "success",
    "cancelled",
    "skipped",
    "neutral",
    "action_required",
    "stale",
    "startup_failure",
    "something_new",
    null,
    ABSENT,
    1,
  ])("failedWorkflowRun answers undefined when conclusion is %s", (conclusion) => {
    const run = failedWorkflowRun("workflow_run", variant(prRun, ["workflow_run", "conclusion"], conclusion));

    expect(run, "run").toBeUndefined();
  });

  it.each<unknown>(["requested", "in_progress", "", null, ABSENT, 1])(
    "failedWorkflowRun answers undefined when action is %s",
    (action) => {
      const run = failedWorkflowRun("workflow_run", variant(prRun, ["action"], action));

      expect(run, "run").toBeUndefined();
    },
  );

  it.each<{ field: string; path: readonly string[]; value: unknown }>([
    { field: "workflow_run", path: ["workflow_run"], value: ABSENT },
    { field: "workflow_run", path: ["workflow_run"], value: [] },
    { field: "workflow_run", path: ["workflow_run"], value: null },
    { field: "workflow_run.head_branch", path: ["workflow_run", "head_branch"], value: ABSENT },
    { field: "workflow_run.head_branch", path: ["workflow_run", "head_branch"], value: 1 },
    { field: "workflow_run.name", path: ["workflow_run", "name"], value: ABSENT },
    { field: "workflow_run.name", path: ["workflow_run", "name"], value: 1 },
    { field: "workflow_run.html_url", path: ["workflow_run", "html_url"], value: ABSENT },
    { field: "workflow_run.html_url", path: ["workflow_run", "html_url"], value: 1 },
    { field: "workflow_run.head_repository", path: ["workflow_run", "head_repository"], value: ABSENT },
    { field: "workflow_run.head_repository", path: ["workflow_run", "head_repository"], value: null },
    { field: "workflow_run.head_repository.id", path: ["workflow_run", "head_repository", "id"], value: ABSENT },
    { field: "workflow_run.head_repository.id", path: ["workflow_run", "head_repository", "id"], value: "2001" },
    { field: "workflow_run.head_repository.id", path: ["workflow_run", "head_repository", "id"], value: 0 },
    { field: "workflow_run.head_repository.id", path: ["workflow_run", "head_repository", "id"], value: 1.5 },
    { field: "repository.id", path: ["repository", "id"], value: ABSENT },
    { field: "repository.id", path: ["repository", "id"], value: "2001" },
    { field: "repository.id", path: ["repository", "id"], value: 0 },
    { field: "repository.id", path: ["repository", "id"], value: 1.5 },
    { field: "repository.full_name", path: ["repository", "full_name"], value: ABSENT },
    { field: "repository.full_name", path: ["repository", "full_name"], value: 1 },
    { field: "repository.default_branch", path: ["repository", "default_branch"], value: ABSENT },
    { field: "repository.default_branch", path: ["repository", "default_branch"], value: 1 },
  ])("failedWorkflowRun answers undefined when $field is $value", ({ path, value }) => {
    const run = failedWorkflowRun("workflow_run", variant(prRun, path, value));

    expect(run, "run").toBeUndefined();
  });

  it.each(["pull_request", "push", "ping", ""])(
    "failedWorkflowRun answers undefined for the event name %s",
    (event) => {
      const run = failedWorkflowRun(event, prRun);

      expect(run, "run").toBeUndefined();
    },
  );

  it("failedWorkflowRun answers undefined for the real pull_request opened body under the event workflow_run", () => {
    const run = failedWorkflowRun("workflow_run", pullRequestOpened);

    expect(run, "run").toBeUndefined();
  });

  it("failedWorkflowRun is not on the default branch when the head branch differs from the default branch", () => {
    const run = failedWorkflowRun("workflow_run", variant(MAIN_FAILURE, ["workflow_run", "head_branch"], "develop"));

    expect(run?.onDefaultBranch, "on the default branch").toBe(false);
  });

  it("failedWorkflowRun is not on the default branch when the head repository is another repository", () => {
    const run = failedWorkflowRun(
      "workflow_run",
      variant(MAIN_FAILURE, ["workflow_run", "head_repository", "id"], 9999),
    );

    expect(run?.onDefaultBranch, "on the default branch").toBe(false);
  });

  it.each<{ case: string; commit: unknown }>([
    { case: "null", commit: null },
    { case: "an object without message", commit: {} },
    { case: "an object with a number as message", commit: { message: 7 } },
    { case: "an empty first line", commit: { message: "\nbody" } },
    { case: "a blank first line", commit: { message: "   \nbody" } },
  ])("failedWorkflowRun gives the branch alone as line 3 when head_commit is $case", ({ commit }) => {
    const run = failedWorkflowRun("workflow_run", variant(MAIN_FAILURE, ["workflow_run", "head_commit"], commit));

    expect(run?.context, "line 3").toBe("main");
  });

  it("failedWorkflowRun gives the branch alone as line 3 when head_commit is absent", () => {
    const run = failedWorkflowRun("workflow_run", variant(MAIN_FAILURE, ["workflow_run", "head_commit"], ABSENT));

    expect(run?.context, "line 3").toBe("main");
  });

  it("failedWorkflowRun shows only the first line of a multi-line commit message", () => {
    const commit = { message: "Fix the parser\n\nLonger body" };

    const run = failedWorkflowRun("workflow_run", variant(MAIN_FAILURE, ["workflow_run", "head_commit"], commit));

    expect(run?.context, "line 3").toBe("main · Fix the parser");
  });

  it("failedWorkflowRun has no pull request number when pull_requests is not an array", () => {
    const run = failedWorkflowRun("workflow_run", variant(prRun, ["workflow_run", "pull_requests"], ABSENT));

    expect(run?.pullRequestNumber, "pull request number").toBeUndefined();
  });
});

describe("firstCommitLine", () => {
  it.each<{ case: string; message: string }>([
    { case: "a line feed", message: "a\nb" },
    { case: "a carriage return and line feed", message: "a\r\nb" },
    { case: "a carriage return", message: "a\rb" },
  ])("firstCommitLine keeps the text before the first line feed or carriage return ($case)", ({ message }) => {
    const line = firstCommitLine(message);

    expect(line, "first line").toBe("a");
  });

  it("firstCommitLine trims the first line", () => {
    const line = firstCommitLine("  a b  \nc");

    expect(line, "first line").toBe("a b");
  });

  it("firstCommitLine returns a single-line message unchanged", () => {
    const line = firstCommitLine("Only one line");

    expect(line, "first line").toBe("Only one line");
  });

  it.each<unknown>([undefined, null, 7, {}, []])("firstCommitLine returns an empty text for %s", (message) => {
    const line = firstCommitLine(message);

    expect(line, "first line").toBe("");
  });
});

describe("pullRequestNumberOf", () => {
  it("pullRequestNumberOf takes the number of the real pull request run", () => {
    const number = pullRequestNumberOf(prRun.workflow_run.pull_requests, REPOSITORY_ID);

    expect(number, "number").toBe(296);
  });

  it("pullRequestNumberOf answers undefined for an empty list", () => {
    const number = pullRequestNumberOf([], REPOSITORY_ID);

    expect(number, "number").toBeUndefined();
  });

  it("pullRequestNumberOf takes the first entry of the repository when several count", () => {
    const entries = [VALID_ENTRY, { number: 297, base: { repo: { id: REPOSITORY_ID } } }];

    const number = pullRequestNumberOf(entries, REPOSITORY_ID);

    expect(number, "number").toBe(296);
  });

  it.each<{ case: string; entry: unknown }>([
    { case: "not an object", entry: "x" },
    { case: "null", entry: null },
    { case: "an array", entry: [] },
    { case: "a number missing", entry: { base: { repo: { id: REPOSITORY_ID } } } },
    { case: "a number 0", entry: { number: 0, base: { repo: { id: REPOSITORY_ID } } } },
    { case: "a number 1.5", entry: { number: 1.5, base: { repo: { id: REPOSITORY_ID } } } },
    { case: "a number as text", entry: { number: "296", base: { repo: { id: REPOSITORY_ID } } } },
    { case: "a number 2^53", entry: { number: 2 ** 53, base: { repo: { id: REPOSITORY_ID } } } },
    { case: "base missing", entry: { number: 295 } },
    { case: "base.repo missing", entry: { number: 295, base: {} } },
    { case: "base.repo.id missing", entry: { number: 295, base: { repo: {} } } },
    { case: "base.repo.id as text", entry: { number: 295, base: { repo: { id: "2001" } } } },
    { case: "base.repo.id 0", entry: { number: 295, base: { repo: { id: 0 } } } },
    { case: "base.repo.id of another repository", entry: { number: 295, base: { repo: { id: 9999 } } } },
  ])("pullRequestNumberOf takes the first entry of the repository, skipping an entry with $case", ({ entry }) => {
    const number = pullRequestNumberOf([entry, VALID_ENTRY], REPOSITORY_ID);

    expect(number, "number").toBe(296);
  });

  it("pullRequestNumberOf answers undefined when no entry counts", () => {
    const number = pullRequestNumberOf([null, { number: 5, base: { repo: { id: 9999 } } }], REPOSITORY_ID);

    expect(number, "number").toBeUndefined();
  });

  it.each<unknown>([undefined, {}, "x", null, 5])(
    "pullRequestNumberOf answers undefined for %s, which is not an array",
    (value) => {
      const number = pullRequestNumberOf(value, REPOSITORY_ID);

      expect(number, "number").toBeUndefined();
    },
  );
});

describe("pullRequestRefOf", () => {
  it("pullRequestRefOf splits the full name into owner and repository", () => {
    const ref = pullRequestRefOf("example-owner/example-repo", 42);

    expect(ref, "ref").toEqual({ owner: "example-owner", repo: "example-repo", number: 42 });
  });

  it("pullRequestRefOf splits at the first slash", () => {
    const ref = pullRequestRefOf("a/b/c", 1);

    expect(ref, "ref").toEqual({ owner: "a", repo: "b/c", number: 1 });
  });

  it.each(["noslash", "/name"])(
    "pullRequestRefOf returns empty owner and repository for the malformed full name %j",
    (fullName) => {
      const ref = pullRequestRefOf(fullName, 1);

      expect(ref, "ref").toEqual({ owner: "", repo: "", number: 1 });
    },
  );
});
