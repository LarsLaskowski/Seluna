import { describe, expect, it } from "vitest";
import appearedInBranch from "../../test/fixtures/code_scanning_alert/appeared_in_branch.json";
import closedByUser from "../../test/fixtures/code_scanning_alert/closed_by_user.json";
import created from "../../test/fixtures/code_scanning_alert/created.json";
import createdPullRequest from "../../test/fixtures/code_scanning_alert/created-pull-request.json";
import reopened from "../../test/fixtures/code_scanning_alert/reopened.json";
import dependabotCreated from "../../test/fixtures/dependabot_alert/created.json";
import secretCreated from "../../test/fixtures/secret_scanning_alert/created.json";
import { ABSENT, variant } from "../../test/pull-request";
import { MALFORMED_IDENTIFYING_FIELDS, withFields } from "../../test/security-alert";
import type { MalformedField } from "../../test/security-alert";
import { DEFAULT_SETTINGS } from "../settings";
import { CODE_SCANNING_ALERT } from "./code-scanning-alert";
import type { WebhookPayload } from "./rule";

const GERMAN = { ...DEFAULT_SETTINGS, language: "de" } as const;
const EXPECTED = {
  title: "Code scanning alert",
  repository: "example-owner/example-repo",
  number: 42,
  subject: 'Arbitrary file write during zip extraction ("Zip Slip")',
  context: "error · js/zipslip",
  url: "https://github.com/example-owner/example-repo/code-scanning/42",
};
const SECURITY_SEVERITY = ["alert", "rule", "security_severity_level"] as const;
const SEVERITY = ["alert", "rule", "severity"] as const;
const RULE_ID = ["alert", "rule", "id"] as const;
const DESCRIPTION = ["alert", "rule", "description"] as const;
const DEFAULT_BRANCH = ["repository", "default_branch"] as const;

interface RefCase {
  readonly action: string;
  readonly label: string;
  readonly ref: unknown;
}

const NON_DEFAULT_REFS: readonly { readonly label: string; readonly ref: unknown }[] = [
  { label: "refs/pull/1/merge", ref: "refs/pull/1/merge" },
  { label: "refs/pull/1/head", ref: "refs/pull/1/head" },
  { label: "refs/heads/feature", ref: "refs/heads/feature" },
  { label: "refs/heads/main/x", ref: "refs/heads/main/x" },
  { label: "refs/tags/main", ref: "refs/tags/main" },
  { label: "an empty string", ref: "" },
  { label: "null", ref: null },
  { label: "absent", ref: ABSENT },
];
const REPORTED_ACTIONS = ["created", "reopened", "appeared_in_branch"];
const REF_CASES: readonly RefCase[] = REPORTED_ACTIONS.flatMap((action) =>
  NON_DEFAULT_REFS.map(({ label, ref }) => ({ action, label, ref })),
);

function evaluate(payload: WebhookPayload): ReturnType<typeof CODE_SCANNING_ALERT.evaluate> {
  return CODE_SCANNING_ALERT.evaluate("code_scanning_alert", payload, DEFAULT_SETTINGS, undefined);
}

describe("CODE_SCANNING_ALERT", () => {
  it("CODE_SCANNING_ALERT reports the documented created alert on the default branch in English", () => {
    const notification = CODE_SCANNING_ALERT.evaluate("code_scanning_alert", created, DEFAULT_SETTINGS, undefined);

    expect(CODE_SCANNING_ALERT.id, "id").toBe("code_scanning_alert");
    expect(notification, "notification").toEqual(EXPECTED);
    expect(notification?.draftCheck, "draft check").toBeUndefined();
  });

  it("CODE_SCANNING_ALERT reports a reopened alert on the default branch with the same lines", () => {
    const notification = evaluate(reopened);

    expect(notification, "notification").toEqual(EXPECTED);
  });

  it("CODE_SCANNING_ALERT reports the alert that appeared in the default branch", () => {
    const notification = evaluate(appearedInBranch);

    expect(notification, "notification").toEqual(EXPECTED);
  });

  it("CODE_SCANNING_ALERT reports in German", () => {
    const notification = CODE_SCANNING_ALERT.evaluate("code_scanning_alert", created, GERMAN, undefined);

    expect(notification, "notification").toEqual({ ...EXPECTED, title: "Code-Scanning-Warnung" });
  });

  it("CODE_SCANNING_ALERT reports a created alert whose ref is the bare default branch name", () => {
    const payload = variant(created, ["ref"], "main");

    const notification = evaluate(payload);

    expect(notification, "notification").toEqual(EXPECTED);
  });

  it("CODE_SCANNING_ALERT reports a created alert on a default branch with another name", () => {
    const payload = withFields(created, [
      [DEFAULT_BRANCH, "develop"],
      [["ref"], "refs/heads/develop"],
    ]);

    const notification = evaluate(payload);

    expect(notification, "notification").toEqual(EXPECTED);
  });

  it("CODE_SCANNING_ALERT reports nothing for a ref of main when the default branch has another name", () => {
    const payload = variant(created, DEFAULT_BRANCH, "develop");

    const notification = evaluate(payload);

    expect(notification, "notification").toBeUndefined();
  });

  it("CODE_SCANNING_ALERT reports nothing for an empty ref when the default branch is empty", () => {
    const payload = withFields(created, [
      [DEFAULT_BRANCH, ""],
      [["ref"], ""],
    ]);

    const notification = evaluate(payload);

    expect(notification, "notification").toBeUndefined();
  });

  it.each<RefCase>(REF_CASES)("CODE_SCANNING_ALERT reports nothing for $action with ref $label", ({ action, ref }) => {
    const payload = withFields(created, [
      [["action"], action],
      [["ref"], ref],
    ]);

    const notification = evaluate(payload);

    expect(notification, "notification").toBeUndefined();
  });

  it("CODE_SCANNING_ALERT reports nothing for the documented pull request alert", () => {
    const notification = evaluate(createdPullRequest);

    expect(notification, "notification").toBeUndefined();
  });

  it("CODE_SCANNING_ALERT reports nothing for the documented closed_by_user alert", () => {
    const notification = evaluate(closedByUser);

    expect(notification, "notification").toBeUndefined();
  });

  it.each(["fixed", "reopened_by_user", "updated_assignment", "some_new_action"])(
    "CODE_SCANNING_ALERT reports nothing for the action %s",
    (action) => {
      const payload = variant(created, ["action"], action);

      const notification = evaluate(payload);

      expect(notification, "notification").toBeUndefined();
    },
  );

  it.each<MalformedField>(MALFORMED_IDENTIFYING_FIELDS)(
    "CODE_SCANNING_ALERT reports nothing when $field is $label",
    ({ path, value }) => {
      const payload = variant(created, path, value);

      const notification = evaluate(payload);

      expect(notification, "notification").toBeUndefined();
    },
  );

  it.each<{ case: string; value: unknown }>([
    { case: "missing", value: ABSENT },
    { case: "null", value: null },
    { case: "a string", value: "rule" },
    { case: "an array", value: [] },
  ])("CODE_SCANNING_ALERT reports nothing without alert.rule as an object: $case", ({ value }) => {
    const payload = variant(created, ["alert", "rule"], value);

    const notification = evaluate(payload);

    expect(notification, "notification").toBeUndefined();
  });

  it.each<{ field: string; path: readonly string[]; value: unknown }>([
    { field: "ref", path: ["ref"], value: ABSENT },
    { field: "ref", path: ["ref"], value: 7 },
    { field: "repository.default_branch", path: DEFAULT_BRANCH, value: ABSENT },
    { field: "repository.default_branch", path: DEFAULT_BRANCH, value: null },
    { field: "repository.default_branch", path: DEFAULT_BRANCH, value: 7 },
  ])("CODE_SCANNING_ALERT reports nothing when $field is $value", ({ path, value }) => {
    const payload = variant(created, path, value);

    const notification = evaluate(payload);

    expect(notification, "notification").toBeUndefined();
  });

  it.each<{ case: string; payload: WebhookPayload }>([
    { case: "Dependabot alert", payload: dependabotCreated },
    { case: "secret scanning alert", payload: secretCreated },
  ])("CODE_SCANNING_ALERT reports nothing for the documented created $case under its event name", ({ payload }) => {
    const notification = evaluate(payload);

    expect(notification, "notification").toBeUndefined();
  });

  it.each(["dependabot_alert", "secret_scanning_alert", "pull_request", ""])(
    "CODE_SCANNING_ALERT reports nothing for its payload under the event name %s",
    (event) => {
      const notification = CODE_SCANNING_ALERT.evaluate(event, created, DEFAULT_SETTINGS, undefined);

      expect(notification, "notification").toBeUndefined();
    },
  );

  it.each<{ case: string; value: unknown }>([
    { case: "absent", value: ABSENT },
    { case: "null", value: null },
    { case: "empty", value: "" },
    { case: "only spaces", value: "  " },
    { case: "a number", value: 5 },
  ])("CODE_SCANNING_ALERT falls back to rule.severity when security_severity_level is $case", ({ value }) => {
    const payload = variant(created, SECURITY_SEVERITY, value);

    const notification = evaluate(payload);

    expect(notification?.context, "line 3").toBe("error · js/zipslip");
  });

  it("CODE_SCANNING_ALERT shows security_severity_level before rule.severity when GitHub sends it", () => {
    const payload = variant(created, SECURITY_SEVERITY, "high");

    const notification = evaluate(payload);

    expect(notification?.context, "line 3").toBe("high · js/zipslip");
  });

  it.each<{ case: string; value: unknown }>([
    { case: "absent", value: ABSENT },
    { case: "null", value: null },
    { case: "empty", value: "" },
  ])("CODE_SCANNING_ALERT shows the rule id alone without either severity: rule.severity $case", ({ value }) => {
    const payload = variant(created, SEVERITY, value);

    const notification = evaluate(payload);

    expect(notification, "notification").toEqual({ ...EXPECTED, context: "js/zipslip" });
  });

  it("CODE_SCANNING_ALERT shows the severity alone without a rule id", () => {
    const payload = variant(created, RULE_ID, ABSENT);

    const notification = evaluate(payload);

    expect(notification, "notification").toEqual({ ...EXPECTED, context: "error" });
  });

  it("CODE_SCANNING_ALERT has no line 3 without any severity and rule id", () => {
    const payload = withFields(created, [
      [SEVERITY, ABSENT],
      [RULE_ID, ABSENT],
    ]);

    const notification = evaluate(payload);

    expect(notification, "notification").toEqual({ ...EXPECTED, context: "" });
  });

  it.each<{ case: string; value: unknown }>([
    { case: "missing", value: ABSENT },
    { case: "null", value: null },
    { case: "a number", value: 5 },
    { case: "empty", value: "" },
  ])("CODE_SCANNING_ALERT has no line 2 when rule.description is $case", ({ value }) => {
    const payload = variant(created, DESCRIPTION, value);

    const notification = evaluate(payload);

    expect(notification, "notification").toEqual({ ...EXPECTED, subject: "" });
  });

  it("CODE_SCANNING_ALERT shows an unknown severity as sent", () => {
    const payload = variant(created, SEVERITY, "catastrophic");

    const notification = evaluate(payload);

    expect(notification?.context, "line 3").toBe("catastrophic · js/zipslip");
  });
});
