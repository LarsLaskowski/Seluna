import { describe, expect, it } from "vitest";
import codeScanningCreated from "../../test/fixtures/code_scanning_alert/created.json";
import dependabotCreated from "../../test/fixtures/dependabot_alert/created.json";
import { ABSENT, variant } from "../../test/pull-request";
import { MALFORMED_IDENTIFYING_FIELDS } from "../../test/security-alert";
import type { MalformedField } from "../../test/security-alert";
import { firstText, joinContext, securityAlert, stringAt } from "./security-alert";

const CREATED_AND_REOPENED = new Set(["created", "reopened"]);

describe("securityAlert", () => {
  it("securityAlert returns the narrowed common fields of the documented created Dependabot alert", () => {
    const fields = securityAlert("dependabot_alert", dependabotCreated, "dependabot_alert", CREATED_AND_REOPENED);

    expect(fields, "fields").toEqual({
      repository: "example-owner/example-repo",
      repositoryRecord: dependabotCreated.repository,
      number: 1,
      url: "https://github.com/example-owner/example-repo/security/dependabot/1",
      alert: dependabotCreated.alert,
    });
  });

  it("securityAlert accepts the documented created code scanning alert under its own event", () => {
    const fields = securityAlert(
      "code_scanning_alert",
      codeScanningCreated,
      "code_scanning_alert",
      new Set(["created"]),
    );

    expect(fields?.number, "number").toBe(42);
  });

  it.each<number>([1, 2 ** 53 - 1])("securityAlert accepts the alert number %d", (number) => {
    const payload = variant(dependabotCreated, ["alert", "number"], number);

    const fields = securityAlert("dependabot_alert", payload, "dependabot_alert", CREATED_AND_REOPENED);

    expect(fields?.number, "number").toBe(number);
  });

  it.each<MalformedField>(MALFORMED_IDENTIFYING_FIELDS)(
    "securityAlert returns undefined when $field is $label",
    ({ path, value }) => {
      const payload = variant(dependabotCreated, path, value);

      const fields = securityAlert("dependabot_alert", payload, "dependabot_alert", CREATED_AND_REOPENED);

      expect(fields, "fields").toBeUndefined();
    },
  );

  it.each(["code_scanning_alert", "secret_scanning_alert", "pull_request", ""])(
    "securityAlert returns undefined for the event name %s when dependabot_alert is expected",
    (event) => {
      const fields = securityAlert(event, dependabotCreated, "dependabot_alert", CREATED_AND_REOPENED);

      expect(fields, "fields").toBeUndefined();
    },
  );

  it.each<{ label: string; action: unknown }>([
    { label: "an action outside the set", action: "dismissed" },
    { label: "a missing action", action: ABSENT },
    { label: "a null action", action: null },
    { label: "a non-string action", action: 7 },
  ])("securityAlert returns undefined for $label", ({ action }) => {
    const payload = variant(dependabotCreated, ["action"], action);

    const fields = securityAlert("dependabot_alert", payload, "dependabot_alert", CREATED_AND_REOPENED);

    expect(fields, "fields").toBeUndefined();
  });

  it("securityAlert returns undefined for an action that is not in a set holding only another action", () => {
    const fields = securityAlert("dependabot_alert", dependabotCreated, "dependabot_alert", new Set(["reopened"]));

    expect(fields, "fields").toBeUndefined();
  });
});

describe("stringAt", () => {
  const RECORD = { a: { b: { c: "deep" } }, top: "text", empty: "", nothing: null, count: 7, list: ["x"] };

  it.each<{ case: string; path: readonly string[]; expected: string | undefined }>([
    { case: "a top-level string", path: ["top"], expected: "text" },
    { case: "a nested string", path: ["a", "b", "c"], expected: "deep" },
    { case: "an empty string", path: ["empty"], expected: "" },
  ])("stringAt returns the string for $case", ({ path, expected }) => {
    const value = stringAt(RECORD, path);

    expect(value, "value").toBe(expected);
  });

  it.each<{ case: string; path: readonly string[] }>([
    { case: "a missing top-level field", path: ["missing"] },
    { case: "a missing step", path: ["a", "x", "c"] },
    { case: "null", path: ["nothing"] },
    { case: "a number", path: ["count"] },
    { case: "an object", path: ["a", "b"] },
    { case: "an array", path: ["list"] },
    { case: "a step that is a string", path: ["top", "length"] },
    { case: "a step that is null", path: ["nothing", "x"] },
    { case: "a step that is an array", path: ["list", "0"] },
  ])("stringAt returns undefined for a missing, null or non-string field: $case", ({ path }) => {
    const value = stringAt(RECORD, path);

    expect(value, "value").toBeUndefined();
  });
});

describe("firstText", () => {
  it.each<{ case: string; values: readonly (string | undefined)[]; expected: string | undefined }>([
    { case: "the first value", values: ["a", "b"], expected: "a" },
    { case: "the second after an empty first", values: ["", "b"], expected: "b" },
    { case: "the second after a first of spaces", values: ["  ", "b"], expected: "b" },
    { case: "the second after an absent first", values: [undefined, "b"], expected: "b" },
    { case: "the third after an empty and an absent value", values: ["", undefined, "c"], expected: "c" },
    { case: "the first trimmed", values: ["  a  ", "b"], expected: "a" },
    { case: "undefined for no value", values: [], expected: undefined },
    { case: "undefined for blank and absent values only", values: ["", "   ", undefined], expected: undefined },
  ])("firstText returns the first non-blank string: $case", ({ values, expected }) => {
    const text = firstText(values);

    expect(text, "text").toBe(expected);
  });
});

describe("joinContext", () => {
  it.each<{ case: string; parts: readonly (string | undefined)[]; expected: string }>([
    { case: "two parts", parts: ["high", "lodash"], expected: "high · lodash" },
    { case: "a first part alone", parts: ["high", undefined], expected: "high" },
    { case: "a second part alone", parts: [undefined, "lodash"], expected: "lodash" },
    { case: "parts with a blank one between", parts: ["high", "  ", "lodash"], expected: "high · lodash" },
    { case: "untrimmed parts", parts: ["  high ", " lodash"], expected: "high · lodash" },
    { case: "an empty first part", parts: ["", "lodash"], expected: "lodash" },
    { case: "blank and absent parts only", parts: ["", "   ", undefined], expected: "" },
    { case: "no parts", parts: [], expected: "" },
  ])("joinContext joins the non-blank parts with a middle dot: $case", ({ parts, expected }) => {
    const text = joinContext(parts);

    expect(text, "text").toBe(expected);
  });
});
