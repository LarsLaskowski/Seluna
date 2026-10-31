import { describe, expect, it } from "vitest";
import {
  activityDigestFromStored,
  activityDigestToStored,
  DEFAULT_ACTIVITY_DIGEST,
  DEFAULT_SETTINGS,
  isTimeZone,
  RULE_IDS,
  SETTING_KEYS,
  settingsFromStored,
  settingsToStored,
  timeZones,
} from "./settings";
import type { ActivityDigest, NotificationSettings } from "./settings";

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
  repository_starred: false,
  repository_forked: false,
};

/** Settings that differ from the default in every field. */
const NON_DEFAULT: NotificationSettings = {
  language: "de",
  timeZone: "Europe/Berlin",
  quietHours: { start: "22:00", end: "07:00" },
  activityDigest: { kind: "immediate" },
  rules: ALL_RULES_OFF,
  updateNotice: false,
};

const DAILY_18: ActivityDigest = { kind: "daily", time: "18:00" };

/** The stored rows that read as `NON_DEFAULT`. */
function nonDefaultRows(): Map<string, string> {
  const rows = new Map<string, string>([
    ["notification_language", "de"],
    ["time_zone", "Europe/Berlin"],
    ["quiet_hours", "22:00-07:00"],
    ["update_notice", "off"],
    ["activity_digest", "immediate"],
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

  it("settingsFromStored reads the two activity switches as off without rows and keeps every stored switch", () => {
    const withoutRows = settingsFromStored(new Map());
    const stored = settingsFromStored(
      new Map([
        ["rule_repository_starred", "on"],
        ["rule_repository_forked", "off"],
      ]),
    );

    expect(
      [withoutRows.rules.repository_starred, withoutRows.rules.repository_forked],
      "switches without rows",
    ).toEqual([false, false]);
    expect([stored.rules.repository_starred, stored.rules.repository_forked], "stored switches").toEqual([true, false]);
    expect(stored.rules.pull_request_opened, "an existing rule without a row").toBe(true);
  });

  it("settingsFromStored lists the issue and comment rules and then the star and fork rules last", () => {
    expect(RULE_IDS.slice(-6), "last rule ids").toEqual([
      "secret_scanning_alert",
      "issue_opened",
      "issue_comment",
      "pull_request_comment",
      "repository_starred",
      "repository_forked",
    ]);
    expect(
      [
        DEFAULT_SETTINGS.rules.issue_opened,
        DEFAULT_SETTINGS.rules.issue_comment,
        DEFAULT_SETTINGS.rules.pull_request_comment,
        DEFAULT_SETTINGS.rules.repository_starred,
        DEFAULT_SETTINGS.rules.repository_forked,
      ],
      "defaults of the newer rules",
    ).toEqual([true, true, true, false, false]);
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
    { key: "activity_digest", value: "daily@24:00", expected: { ...NON_DEFAULT, activityDigest: DAILY_18 } },
    { key: "activity_digest", value: "daily@", expected: { ...NON_DEFAULT, activityDigest: DAILY_18 } },
    { key: "activity_digest", value: "weekly", expected: { ...NON_DEFAULT, activityDigest: DAILY_18 } },
  ])("settingsFromStored falls back per key for an invalid value: $key $value", ({ key, value, expected }) => {
    const rows = nonDefaultRows();
    rows.set(key, value);

    const settings = settingsFromStored(rows);

    expect(settings, "only the invalid key reads as its default").toEqual(expected);
  });
});

describe("activityDigestFromStored", () => {
  it.each([
    { value: "immediate", expected: { kind: "immediate" } },
    { value: "hourly", expected: { kind: "hourly" } },
    { value: "daily@18:00", expected: { kind: "daily", time: "18:00" } },
    { value: "daily@00:00", expected: { kind: "daily", time: "00:00" } },
    { value: "daily@06:45", expected: { kind: "daily", time: "06:45" } },
    { value: "daily@23:59", expected: { kind: "daily", time: "23:59" } },
  ] as const)("activityDigestFromStored reads $value", ({ value, expected }) => {
    const digest = activityDigestFromStored(value);

    expect(digest, "digest").toEqual(expected);
  });

  it.each([
    { case: "an absent value", value: undefined },
    { case: "the empty text", value: "" },
    { case: "the hour 24", value: "daily@24:00" },
    { case: "the minute 60", value: "daily@18:60" },
    { case: "a daily digest without a time", value: "daily@" },
    { case: "a daily digest without the at sign", value: "daily" },
    { case: "a time with a one-digit hour", value: "daily@6:00" },
    { case: "a time with seconds", value: "daily@18:00:00" },
    { case: "a time with a trailing space", value: "daily@18:00 " },
    { case: "an unknown interval", value: "weekly" },
    { case: "a capitalised interval", value: "Daily@18:00" },
    { case: "an upper-case immediate", value: "IMMEDIATE" },
    { case: "a time after hourly", value: "hourly@18:00" },
    { case: "a time after immediate", value: "immediate@18:00" },
  ])("activityDigestFromStored reads $case as daily at 18:00", ({ value }) => {
    const digest = activityDigestFromStored(value);

    expect(digest, "digest").toEqual({ kind: "daily", time: "18:00" });
  });

  it("DEFAULT_ACTIVITY_DIGEST is daily at 18:00 and the default settings use it", () => {
    expect(DEFAULT_ACTIVITY_DIGEST, "constant").toEqual({ kind: "daily", time: "18:00" });
    expect(DEFAULT_SETTINGS.activityDigest, "default settings").toEqual({ kind: "daily", time: "18:00" });
  });
});

describe("activityDigestToStored", () => {
  it.each([
    { digest: { kind: "immediate" }, expected: "immediate" },
    { digest: { kind: "hourly" }, expected: "hourly" },
    { digest: { kind: "daily", time: "06:45" }, expected: "daily@06:45" },
    { digest: { kind: "daily", time: "18:00" }, expected: "daily@18:00" },
  ] as const)("activityDigestToStored writes $expected", ({ digest, expected }) => {
    const stored = activityDigestToStored(digest);

    expect(stored, "stored value").toBe(expected);
  });

  it.each([
    { digest: { kind: "immediate" } },
    { digest: { kind: "hourly" } },
    { digest: { kind: "daily", time: "23:59" } },
  ] as const)("activityDigestToStored and activityDigestFromStored round-trip $digest.kind", ({ digest }) => {
    const read = activityDigestFromStored(activityDigestToStored(digest));

    expect(read, "digest read back").toEqual(digest);
  });
});

describe("settingsToStored", () => {
  it("settingsToStored stores the activity digest under activity_digest and lists the key in SETTING_KEYS", () => {
    const rows = settingsToStored({ ...NON_DEFAULT, activityDigest: { kind: "daily", time: "06:45" } });

    expect(rows, "digest row").toContainEqual(["activity_digest", "daily@06:45"]);
    expect(SETTING_KEYS, "keys of the module").toContain("activity_digest");
    expect(
      rows.map(([key]) => key).sort((left, right) => left.localeCompare(right)),
      "stored keys are exactly the listed keys",
    ).toEqual([...SETTING_KEYS].sort((left, right) => left.localeCompare(right)));
    expect(rows, "eighteen rows").toHaveLength(18);
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
