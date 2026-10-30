import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, isTimeZone, RULE_IDS, settingsFromStored, timeZones } from "./settings";
import type { NotificationSettings } from "./settings";

const ALL_RULES_OFF: NotificationSettings["rules"] = {
  pull_request_opened: false,
  pull_request_ready_for_review: false,
  pull_request_review_requested: false,
  ci_failed_default_branch: false,
  ci_failed_pull_request: false,
  dependabot_alert: false,
  code_scanning_alert: false,
  secret_scanning_alert: false,
  issue_opened: false,
  issue_comment: false,
  pull_request_comment: false,
};

/** Settings that differ from the default in every field. */
const NON_DEFAULT: NotificationSettings = {
  language: "de",
  timeZone: "Europe/Berlin",
  quietHours: { start: "22:00", end: "07:00" },
  rules: ALL_RULES_OFF,
  updateNotice: false,
};

/** The stored rows that read as `NON_DEFAULT`. */
function nonDefaultRows(): Map<string, string> {
  const rows = new Map<string, string>([
    ["notification_language", "de"],
    ["time_zone", "Europe/Berlin"],
    ["quiet_hours", "22:00-07:00"],
    ["update_notice", "off"],
  ]);
  for (const id of RULE_IDS) {
    rows.set(`rule_${id}`, "off");
  }
  return rows;
}

describe("settingsFromStored", () => {
  it("settingsFromStored returns the defaults for an empty map", () => {
    const settings = settingsFromStored(new Map());

    expect(settings, "settings").toEqual(DEFAULT_SETTINGS);
  });

  it("settingsFromStored reads the three new switches as on without rows and keeps every stored switch", () => {
    const rows = new Map<string, string>(RULE_IDS.map((id) => [`rule_${id}`, "off"]));
    rows.delete("rule_issue_opened");
    rows.delete("rule_issue_comment");
    rows.delete("rule_pull_request_comment");
    rows.set("rule_dependabot_alert", "on");

    const settings = settingsFromStored(rows);

    expect(settings.rules, "rules").toEqual({
      ...ALL_RULES_OFF,
      dependabot_alert: true,
      issue_opened: true,
      issue_comment: true,
      pull_request_comment: true,
    });
  });

  it("settingsFromStored lists the three new rules last, after secret_scanning_alert", () => {
    expect(RULE_IDS.slice(-4), "last rule ids").toEqual([
      "secret_scanning_alert",
      "issue_opened",
      "issue_comment",
      "pull_request_comment",
    ]);
    expect(
      [
        DEFAULT_SETTINGS.rules.issue_opened,
        DEFAULT_SETTINGS.rules.issue_comment,
        DEFAULT_SETTINGS.rules.pull_request_comment,
      ],
      "defaults of the new rules",
    ).toEqual([true, true, true]);
  });

  it("settingsFromStored reads each stored value", () => {
    const settings = settingsFromStored(nonDefaultRows());

    expect(settings, "settings").toEqual(NON_DEFAULT);
  });

  it("settingsFromStored reads a rule stored as on as enabled while the others are off", () => {
    const rows = nonDefaultRows();
    rows.set("rule_code_scanning_alert", "on");

    const settings = settingsFromStored(rows);

    expect(settings.rules, "rules").toEqual({ ...ALL_RULES_OFF, code_scanning_alert: true });
  });

  it.each([
    { key: "notification_language", value: "fr", expected: { ...NON_DEFAULT, language: "en" } },
    { key: "time_zone", value: "europe/berlin", expected: { ...NON_DEFAULT, timeZone: "UTC" } },
    { key: "quiet_hours", value: "25:00-07:00", expected: { ...NON_DEFAULT, quietHours: undefined } },
    { key: "quiet_hours", value: "07:00-07:00", expected: { ...NON_DEFAULT, quietHours: undefined } },
    {
      key: "rule_dependabot_alert",
      value: "yes",
      expected: { ...NON_DEFAULT, rules: { ...ALL_RULES_OFF, dependabot_alert: true } },
    },
    { key: "update_notice", value: "", expected: { ...NON_DEFAULT, updateNotice: true } },
  ])("settingsFromStored falls back per key for an invalid value: $key $value", ({ key, value, expected }) => {
    const rows = nonDefaultRows();
    rows.set(key, value);

    const settings = settingsFromStored(rows);

    expect(settings, "only the invalid key reads as its default").toEqual(expected);
  });
});

describe("isTimeZone", () => {
  it.each([{ zone: "UTC" }, { zone: "Europe/Berlin" }, { zone: "America/New_York" }])(
    "isTimeZone accepts $zone",
    ({ zone }) => {
      const result = isTimeZone(zone);

      expect(result, "result").toBe(true);
    },
  );

  it.each([
    { case: "a lower-case name", zone: "europe/berlin" },
    { case: "an upper-case name", zone: "EUROPE/BERLIN" },
    { case: "a positive UTC offset", zone: "+01:00" },
    { case: "a negative UTC offset", zone: "-05:00" },
    { case: "a leading space", zone: " Europe/Berlin" },
    { case: "a trailing space", zone: "Europe/Berlin " },
    { case: "the empty text", zone: "" },
    { case: "an unknown name", zone: "Mars/Base" },
  ])("isTimeZone rejects $case", ({ zone }) => {
    const result = isTimeZone(zone);

    expect(result, "result").toBe(false);
  });

  it("isTimeZone rejects a name followed by a NUL character", () => {
    // One backslash in the source: the text holds a real NUL, so it has 14 characters.
    const zone = "Europe/Berlin\u0000";
    expect(zone.length, "length of the input: the backslash of the escape was kept in the source").toBe(14);

    const result = isTimeZone(zone);

    expect(result, "result").toBe(false);
  });
});

describe("timeZones", () => {
  it("timeZones lists UTC once and only names isTimeZone accepts", () => {
    const zones = timeZones();

    expect(
      zones.filter((zone) => zone === "UTC"),
      "occurrences of UTC",
    ).toHaveLength(1);
    expect(
      zones.filter((zone) => !isTimeZone(zone)),
      "listed names isTimeZone rejects",
    ).toEqual([]);
    expect(zones, "a well-known zone").toContain("Europe/Berlin");
  });
});
