import { describe, expect, it } from "vitest";
import codeScanningCreated from "../../test/fixtures/code_scanning_alert/created.json";
import dependabotCreated from "../../test/fixtures/dependabot_alert/created.json";
import openedDraft from "../../test/fixtures/pull_request/opened-draft.json";
import created from "../../test/fixtures/secret_scanning_alert/created.json";
import reopened from "../../test/fixtures/secret_scanning_alert/reopened.json";
import resolved from "../../test/fixtures/secret_scanning_alert/resolved.json";
import { ABSENT, variant } from "../../test/pull-request";
import {
  MALFORMED_IDENTIFYING_FIELDS,
  SECRET,
  SECRET_SCANNING_READ_PATHS,
  replaceStringsOutside,
  withFields,
} from "../../test/security-alert";
import type { MalformedField } from "../../test/security-alert";
import { DEFAULT_SETTINGS } from "../settings";
import type { WebhookPayload } from "./rule";
import { SECRET_SCANNING_ALERT } from "./secret-scanning-alert";

const GERMAN = { ...DEFAULT_SETTINGS, language: "de" } as const;
const EXPECTED = {
  title: "Secret scanning alert",
  repository: "example-owner/example-repo",
  number: 42,
  subject: "Mailchimp API Key",
  context: "mailchimp_api_key",
  url: "https://github.com/example-owner/example-repo/security/secret-scanning/42",
};
const DISPLAY_NAME = ["alert", "secret_type_display_name"] as const;
const SECRET_TYPE = ["alert", "secret_type"] as const;

function evaluate(payload: WebhookPayload): ReturnType<typeof SECRET_SCANNING_ALERT.evaluate> {
  return SECRET_SCANNING_ALERT.evaluate("secret_scanning_alert", payload, DEFAULT_SETTINGS, undefined);
}

describe("SECRET_SCANNING_ALERT", () => {
  it("SECRET_SCANNING_ALERT reports the documented created alert in English", () => {
    const notification = SECRET_SCANNING_ALERT.evaluate("secret_scanning_alert", created, DEFAULT_SETTINGS, undefined);

    expect(SECRET_SCANNING_ALERT.id, "id").toBe("secret_scanning_alert");
    expect(notification, "notification").toEqual(EXPECTED);
    expect(notification?.draftCheck, "draft check").toBeUndefined();
  });

  it("SECRET_SCANNING_ALERT reports the documented reopened alert with the same lines", () => {
    const notification = evaluate(reopened);

    expect(notification, "notification").toEqual(EXPECTED);
  });

  it("SECRET_SCANNING_ALERT reports in German", () => {
    const notification = SECRET_SCANNING_ALERT.evaluate("secret_scanning_alert", created, GERMAN, undefined);

    expect(notification, "notification").toEqual({ ...EXPECTED, title: "Secret-Scanning-Warnung" });
  });

  it("SECRET_SCANNING_ALERT reports nothing for the documented resolved alert", () => {
    const notification = evaluate(resolved);

    expect(notification, "notification").toBeUndefined();
  });

  it.each(["validated", "publicly_leaked", "assigned", "unassigned", "some_new_action"])(
    "SECRET_SCANNING_ALERT reports nothing for the action %s",
    (action) => {
      const payload = variant(created, ["action"], action);

      const notification = evaluate(payload);

      expect(notification, "notification").toBeUndefined();
    },
  );

  it.each<MalformedField>(MALFORMED_IDENTIFYING_FIELDS)(
    "SECRET_SCANNING_ALERT reports nothing when $field is $label",
    ({ path, value }) => {
      const payload = variant(created, path, value);

      const notification = evaluate(payload);

      expect(notification, "notification").toBeUndefined();
    },
  );

  it.each<{ case: string; value: unknown }>([
    { case: "missing", value: ABSENT },
    { case: "null", value: null },
    { case: "a number", value: 7 },
    { case: "an object", value: {} },
  ])("SECRET_SCANNING_ALERT reports nothing without alert.secret_type as a string: $case", ({ value }) => {
    const payload = variant(created, SECRET_TYPE, value);

    const notification = evaluate(payload);

    expect(notification, "notification").toBeUndefined();
  });

  it.each<{ case: string; payload: WebhookPayload }>([
    { case: "Dependabot alert", payload: dependabotCreated },
    { case: "code scanning alert", payload: codeScanningCreated },
  ])("SECRET_SCANNING_ALERT reports nothing for the documented created $case under its event name", ({ payload }) => {
    const notification = evaluate(payload);

    expect(notification, "notification").toBeUndefined();
  });

  it.each(["dependabot_alert", "code_scanning_alert", "pull_request", ""])(
    "SECRET_SCANNING_ALERT reports nothing for its payload under the event name %s",
    (event) => {
      const notification = SECRET_SCANNING_ALERT.evaluate(event, created, DEFAULT_SETTINGS, undefined);

      expect(notification, "notification").toBeUndefined();
    },
  );

  it.each<{ case: string; value: unknown }>([
    { case: "missing", value: ABSENT },
    { case: "null", value: null },
    { case: "a number", value: 5 },
    { case: "empty", value: "" },
  ])("SECRET_SCANNING_ALERT has no line 2 without a display name: $case", ({ value }) => {
    const payload = variant(created, DISPLAY_NAME, value);

    const notification = evaluate(payload);

    expect(notification, "notification").toEqual({ ...EXPECTED, subject: "" });
  });

  it("SECRET_SCANNING_ALERT shows an unknown secret type as sent", () => {
    const payload = variant(created, SECRET_TYPE, "some_new_secret_type");

    const notification = evaluate(payload);

    expect(notification?.context, "line 3").toBe("some_new_secret_type");
  });

  it("SECRET_SCANNING_ALERT returns the same notification with a secret in alert.secret, alert.resolution_comment and a location field", () => {
    const payload = withFields(created, [
      [["alert", "secret"], SECRET],
      [["alert", "resolution_comment"], SECRET],
      [
        ["alert", "locations_url"],
        `https://api.github.com/repos/example-owner/example-repo/secret-scanning/alerts/42/locations?q=${SECRET}`,
      ],
      [["alert", "location"], { path: SECRET, details: { blob_sha: SECRET } }],
    ]);

    const notification = evaluate(payload);

    expect(notification, "notification").toEqual(EXPECTED);
    expect(JSON.stringify(notification), "serialized notification").not.toContain(SECRET);
  });

  it("SECRET_SCANNING_ALERT returns the same notification when every string outside action and the five read fields of the documented created delivery is the secret", () => {
    const payload = replaceStringsOutside(created, SECRET_SCANNING_READ_PATHS, SECRET);

    const notification = evaluate(payload);

    expect(notification, "notification").toEqual(EXPECTED);
    expect(JSON.stringify(notification), "serialized notification").not.toContain(SECRET);
  });

  it("SECRET_SCANNING_ALERT returns the same notification when the payload carries a ref and a draft pull_request", () => {
    const payload = withFields(created, [
      [["ref"], "refs/pull/274/merge"],
      [["pull_request"], openedDraft.pull_request],
    ]);

    const notification = evaluate(payload);

    expect(openedDraft.pull_request.draft, "the pull request is a draft").toBe(true);
    expect(notification, "notification").toEqual(EXPECTED);
  });
});
