import { describe, expect, it } from "vitest";
import codeScanningCreated from "../../test/fixtures/code_scanning_alert/created.json";
import created from "../../test/fixtures/dependabot_alert/created.json";
import dismissed from "../../test/fixtures/dependabot_alert/dismissed.json";
import reopened from "../../test/fixtures/dependabot_alert/reopened.json";
import secretCreated from "../../test/fixtures/secret_scanning_alert/created.json";
import { ABSENT, variant } from "../../test/pull-request";
import { MALFORMED_IDENTIFYING_FIELDS, withFields } from "../../test/security-alert";
import type { MalformedField } from "../../test/security-alert";
import { DEFAULT_SETTINGS } from "../settings";
import { DEPENDABOT_ALERT } from "./dependabot-alert";
import type { WebhookPayload } from "./rule";

const GERMAN = { ...DEFAULT_SETTINGS, language: "de" } as const;
const EXPECTED = {
  title: "Dependabot alert",
  repository: "example-owner/example-repo",
  number: 1,
  subject: "Insertion of Sensitive Information into Log File in ansible",
  context: "medium · ansible",
  url: "https://github.com/example-owner/example-repo/security/dependabot/1",
};
const ADVISORY_SEVERITY = ["alert", "security_advisory", "severity"] as const;
const VULNERABILITY_SEVERITY = ["alert", "security_vulnerability", "severity"] as const;
const DEPENDENCY_PACKAGE_NAME = ["alert", "dependency", "package", "name"] as const;
const VULNERABILITY_PACKAGE_NAME = ["alert", "security_vulnerability", "package", "name"] as const;
const SUMMARY = ["alert", "security_advisory", "summary"] as const;

function evaluate(payload: WebhookPayload): ReturnType<typeof DEPENDABOT_ALERT.evaluate> {
  return DEPENDABOT_ALERT.evaluate("dependabot_alert", payload, DEFAULT_SETTINGS, undefined);
}

describe("DEPENDABOT_ALERT", () => {
  it("DEPENDABOT_ALERT reports the documented created alert in English", () => {
    const notification = DEPENDABOT_ALERT.evaluate("dependabot_alert", created, DEFAULT_SETTINGS, undefined);

    expect(DEPENDABOT_ALERT.id, "id").toBe("dependabot_alert");
    expect(notification, "notification").toEqual(EXPECTED);
    expect(notification?.draftCheck, "draft check").toBeUndefined();
  });

  it("DEPENDABOT_ALERT reports the documented reopened alert with the same lines", () => {
    const notification = DEPENDABOT_ALERT.evaluate("dependabot_alert", reopened, DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toEqual(EXPECTED);
  });

  it("DEPENDABOT_ALERT reports in German", () => {
    const notification = DEPENDABOT_ALERT.evaluate("dependabot_alert", created, GERMAN, undefined);

    expect(notification, "notification").toEqual({ ...EXPECTED, title: "Dependabot-Warnung" });
  });

  it("DEPENDABOT_ALERT reports nothing for the documented dismissed alert", () => {
    const notification = DEPENDABOT_ALERT.evaluate("dependabot_alert", dismissed, DEFAULT_SETTINGS, undefined);

    expect(notification, "notification").toBeUndefined();
  });

  it.each([
    "fixed",
    "auto_dismissed",
    "auto_reopened",
    "reintroduced",
    "withdrawn",
    "assignees_changed",
    "some_new_action",
  ])("DEPENDABOT_ALERT reports nothing for the action %s", (action) => {
    const payload = variant(created, ["action"], action);

    const notification = evaluate(payload);

    expect(notification, "notification").toBeUndefined();
  });

  it.each<MalformedField>(MALFORMED_IDENTIFYING_FIELDS)(
    "DEPENDABOT_ALERT reports nothing when $field is $label",
    ({ path, value }) => {
      const payload = variant(created, path, value);

      const notification = evaluate(payload);

      expect(notification, "notification").toBeUndefined();
    },
  );

  it.each<{ case: string; value: unknown }>([
    { case: "missing", value: ABSENT },
    { case: "null", value: null },
    { case: "a string", value: "advisory" },
    { case: "an array", value: [] },
  ])("DEPENDABOT_ALERT reports nothing without alert.security_advisory as an object: $case", ({ value }) => {
    const payload = variant(created, ["alert", "security_advisory"], value);

    const notification = evaluate(payload);

    expect(notification, "notification").toBeUndefined();
  });

  it.each<{ case: string; payload: WebhookPayload }>([
    { case: "code scanning alert", payload: codeScanningCreated },
    { case: "secret scanning alert", payload: secretCreated },
  ])("DEPENDABOT_ALERT reports nothing for the documented created $case under its event name", ({ payload }) => {
    const notification = evaluate(payload);

    expect(notification, "notification").toBeUndefined();
  });

  it.each(["code_scanning_alert", "secret_scanning_alert", "pull_request", ""])(
    "DEPENDABOT_ALERT reports nothing for its payload under the event name %s",
    (event) => {
      const notification = DEPENDABOT_ALERT.evaluate(event, created, DEFAULT_SETTINGS, undefined);

      expect(notification, "notification").toBeUndefined();
    },
  );

  it.each<{ case: string; value: unknown }>([
    { case: "absent", value: ABSENT },
    { case: "null", value: null },
    { case: "a number", value: 5 },
    { case: "empty", value: "" },
    { case: "only spaces", value: "  " },
  ])("DEPENDABOT_ALERT shows the severity of the vulnerability when the advisory severity is $case", ({ value }) => {
    const payload = withFields(created, [
      [ADVISORY_SEVERITY, value],
      [VULNERABILITY_SEVERITY, "low"],
    ]);

    const notification = evaluate(payload);

    expect(notification?.context, "line 3").toBe("low · ansible");
  });

  it("DEPENDABOT_ALERT shows the advisory severity before the severity of the vulnerability", () => {
    const payload = withFields(created, [
      [ADVISORY_SEVERITY, "high"],
      [VULNERABILITY_SEVERITY, "low"],
    ]);

    const notification = evaluate(payload);

    expect(notification?.context, "line 3").toBe("high · ansible");
  });

  it.each<{ case: string; value: unknown }>([
    { case: "absent", value: ABSENT },
    { case: "null", value: null },
    { case: "empty", value: "" },
    { case: "only spaces", value: "  " },
  ])(
    "DEPENDABOT_ALERT shows the package of the vulnerability when the dependency package name is $case",
    ({ value }) => {
      const payload = withFields(created, [
        [DEPENDENCY_PACKAGE_NAME, value],
        [VULNERABILITY_PACKAGE_NAME, "other"],
      ]);

      const notification = evaluate(payload);

      expect(notification?.context, "line 3").toBe("medium · other");
    },
  );

  it("DEPENDABOT_ALERT shows the package of the vulnerability when the dependency has no package", () => {
    const payload = withFields(created, [
      [["alert", "dependency", "package"], ABSENT],
      [VULNERABILITY_PACKAGE_NAME, "other"],
    ]);

    const notification = evaluate(payload);

    expect(notification?.context, "line 3").toBe("medium · other");
  });

  it("DEPENDABOT_ALERT shows the dependency package before the package of the vulnerability", () => {
    const payload = withFields(created, [
      [DEPENDENCY_PACKAGE_NAME, "first"],
      [VULNERABILITY_PACKAGE_NAME, "other"],
    ]);

    const notification = evaluate(payload);

    expect(notification?.context, "line 3").toBe("medium · first");
  });

  it("DEPENDABOT_ALERT shows the package alone when no severity is given", () => {
    const payload = withFields(created, [
      [ADVISORY_SEVERITY, ABSENT],
      [VULNERABILITY_SEVERITY, ABSENT],
    ]);

    const notification = evaluate(payload);

    expect(notification, "notification").toEqual({ ...EXPECTED, context: "ansible" });
  });

  it("DEPENDABOT_ALERT shows the severity alone when no package is given", () => {
    const payload = withFields(created, [
      [DEPENDENCY_PACKAGE_NAME, ABSENT],
      [VULNERABILITY_PACKAGE_NAME, ABSENT],
    ]);

    const notification = evaluate(payload);

    expect(notification, "notification").toEqual({ ...EXPECTED, context: "medium" });
  });

  it("DEPENDABOT_ALERT has no line 3 when neither severity nor package is given", () => {
    const payload = withFields(created, [
      [ADVISORY_SEVERITY, ABSENT],
      [VULNERABILITY_SEVERITY, null],
      [DEPENDENCY_PACKAGE_NAME, ABSENT],
      [VULNERABILITY_PACKAGE_NAME, ""],
    ]);

    const notification = evaluate(payload);

    expect(notification, "notification").toEqual({ ...EXPECTED, context: "" });
  });

  it.each<{ case: string; value: unknown }>([
    { case: "missing", value: ABSENT },
    { case: "null", value: null },
    { case: "a number", value: 5 },
    { case: "empty", value: "" },
  ])("DEPENDABOT_ALERT has no line 2 when the advisory summary is $case", ({ value }) => {
    const payload = variant(created, SUMMARY, value);

    const notification = evaluate(payload);

    expect(notification, "notification").toEqual({ ...EXPECTED, subject: "" });
  });

  it("DEPENDABOT_ALERT shows an unknown severity as sent", () => {
    const payload = variant(created, ADVISORY_SEVERITY, "catastrophic");

    const notification = evaluate(payload);

    expect(notification?.context, "line 3").toBe("catastrophic · ansible");
  });
});
