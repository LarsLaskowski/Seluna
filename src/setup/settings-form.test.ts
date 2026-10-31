import { describe, expect, it } from "vitest";
import { RULE_IDS } from "../settings";
import { parseSettingsForm } from "./settings-form";
import { assertKeptUnlisted, spellingsOf, ZONE_PAIRS } from "../../test/time-zones";

type Changes = Readonly<Record<string, string | readonly string[] | undefined>>;

/** The fields of a complete settings form, with `changes` applied: `undefined` removes a field, a list repeats it. */
function fieldsWith(changes: Changes = {}): URLSearchParams {
  const base: Record<string, string | readonly string[] | undefined> = {
    notification_language: "de",
    time_zone: "Europe/Berlin",
    quiet_hours: "on",
    quiet_start: "22:00",
    quiet_end: "07:00",
    update_notice: "on",
    activity_digest: "daily",
    digest_time: "06:45",
    ...Object.fromEntries(RULE_IDS.map((id) => [`rule_${id}`, "on"])),
    ...changes,
  };
  const fields = new URLSearchParams();
  for (const [name, value] of Object.entries(base)) {
    for (const single of typeof value === "string" ? [value] : (value ?? [])) {
      fields.append(name, single);
    }
  }
  return fields;
}

describe("parseSettingsForm", () => {
  it("parseSettingsForm accepts a complete form", () => {
    const settings = parseSettingsForm(fieldsWith());

    expect(settings, "settings").toEqual({
      language: "de",
      timeZone: "Europe/Berlin",
      quietHours: { start: "22:00", end: "07:00" },
      rules: {
        pull_request_opened: true,
        pull_request_ready_for_review: true,
        pull_request_review_requested: true,
        ci_failed_default_branch: true,
        ci_failed_pull_request: true,
        dependabot_alert: true,
        code_scanning_alert: true,
        secret_scanning_alert: true,
        issue_opened: true,
        issue_comment: true,
        pull_request_comment: true,
        repository_starred: true,
        repository_forked: true,
      },
      updateNotice: true,
      activityDigest: { kind: "daily", time: "06:45" },
    });
  });

  it("parseSettingsForm reads the two activity switches and keeps them off when absent", () => {
    const off = fieldsWith({ rule_repository_starred: undefined });
    const onlyFork = fieldsWith({ rule_repository_starred: undefined, rule_repository_forked: undefined });
    onlyFork.append("rule_repository_forked", "on");

    const settings = parseSettingsForm(off);
    const single = parseSettingsForm(onlyFork);

    expect(settings?.rules.repository_starred, "star switch absent").toBe(false);
    expect(settings?.rules.repository_forked, "fork switch on").toBe(true);
    expect(single?.rules.repository_starred, "star switch absent in the second form").toBe(false);
    expect(single?.rules.repository_forked, "fork switch on in the second form").toBe(true);
  });

  it.each([
    {
      case: "immediately",
      changes: { activity_digest: "immediate", digest_time: undefined },
      expected: { kind: "immediate" },
    },
    { case: "hourly", changes: { activity_digest: "hourly", digest_time: undefined }, expected: { kind: "hourly" } },
    {
      case: "daily at 00:00",
      changes: { activity_digest: "daily", digest_time: "00:00" },
      expected: { kind: "daily", time: "00:00" },
    },
    {
      case: "daily at 23:59",
      changes: { activity_digest: "daily", digest_time: "23:59" },
      expected: { kind: "daily", time: "23:59" },
    },
    {
      case: "immediately with a posted time",
      changes: { activity_digest: "immediate", digest_time: "09:30" },
      expected: { kind: "immediate" },
    },
  ] as const)("parseSettingsForm reads the digest $case", ({ changes, expected }) => {
    const settings = parseSettingsForm(fieldsWith(changes));

    expect(settings?.activityDigest, "digest").toEqual(expected);
  });

  it("parseSettingsForm reads the three new switches", () => {
    const off = fieldsWith({ rule_issue_opened: undefined, rule_issue_comment: undefined });
    const onlyComment = fieldsWith({
      rule_issue_opened: undefined,
      rule_issue_comment: undefined,
      rule_pull_request_comment: undefined,
    });
    onlyComment.append("rule_issue_comment", "on");

    const settings = parseSettingsForm(off);
    const single = parseSettingsForm(onlyComment);

    expect(settings?.rules.issue_opened, "issue_opened off").toBe(false);
    expect(settings?.rules.issue_comment, "issue_comment off").toBe(false);
    expect(settings?.rules.pull_request_comment, "pull_request_comment on").toBe(true);
    expect(single?.rules.issue_opened, "issue_opened absent").toBe(false);
    expect(single?.rules.issue_comment, "issue_comment on").toBe(true);
    expect(single?.rules.pull_request_comment, "pull_request_comment absent").toBe(false);
  });

  it.each(ZONE_PAIRS)("parseSettingsForm returns the listed name for a posted alias of $pair", ({ names }) => {
    const { listed, alias } = spellingsOf(names);

    const settings = parseSettingsForm(fieldsWith({ time_zone: alias }));

    expect(settings?.timeZone, "time zone").toBe(listed);
  });

  it("parseSettingsForm returns Europe/Berlin for a time zone in lower case", () => {
    const settings = parseSettingsForm(fieldsWith({ time_zone: "europe/berlin" }));

    expect(settings?.timeZone, "time zone").toBe("Europe/Berlin");
  });

  it.each([{ zone: "Etc/GMT+5" }, { zone: "Etc/GMT-14" }])(
    "parseSettingsForm accepts the posted unlisted zone $zone",
    ({ zone }) => {
      assertKeptUnlisted(zone);

      const settings = parseSettingsForm(fieldsWith({ time_zone: zone }));

      expect(settings?.timeZone, "time zone").toBe(zone);
    },
  );

  it("parseSettingsForm reads an absent checkbox as off", () => {
    const fields = fieldsWith({ quiet_hours: undefined, rule_dependabot_alert: undefined, update_notice: undefined });

    const settings = parseSettingsForm(fields);

    expect(settings?.quietHours, "quiet hours").toBeUndefined();
    expect(settings?.rules.dependabot_alert, "switched-off rule").toBe(false);
    expect(settings?.rules.secret_scanning_alert, "rule still on").toBe(true);
    expect(settings?.updateNotice, "update notice").toBe(false);
  });

  it.each([
    { name: "invalid times", start: "24:00", end: "x" },
    { name: "equal times", start: "07:00", end: "07:00" },
    { name: "missing times", start: undefined, end: undefined },
  ])("parseSettingsForm ignores the times while quiet hours are off: $name", ({ start, end }) => {
    const fields = fieldsWith({ quiet_hours: undefined, quiet_start: start, quiet_end: end });

    const settings = parseSettingsForm(fields);

    expect(settings, "settings are returned").toBeDefined();
    expect(settings?.quietHours, "quiet hours").toBeUndefined();
  });

  it.each([
    { case: "a missing language", changes: { notification_language: undefined } },
    { case: "the language fr", changes: { notification_language: "fr" } },
    { case: "a repeated language", changes: { notification_language: ["de", "de"] } },
    { case: "a repeated time_zone", changes: { time_zone: ["Europe/Berlin", "Europe/Berlin"] } },
    { case: "a missing time_zone", changes: { time_zone: undefined } },
    { case: "the unknown time zone Mars/Base", changes: { time_zone: "Mars/Base" } },
    { case: "the offset +01:00 as time zone", changes: { time_zone: "+01:00" } },
    { case: "the checkbox value 1", changes: { update_notice: "1" } },
    { case: "the checkbox value 1 of quiet_hours", changes: { quiet_hours: "1" } },
    { case: "a repeated rule checkbox", changes: { rule_ci_failed_pull_request: ["on", "on"] } },
    { case: "quiet hours without quiet_start", changes: { quiet_start: undefined } },
    { case: "quiet hours without quiet_end", changes: { quiet_end: undefined } },
    { case: "a repeated quiet_start", changes: { quiet_start: ["22:00", "22:00"] } },
    { case: "the start 24:00", changes: { quiet_start: "24:00" } },
    { case: "the start 7:00", changes: { quiet_start: "7:00" } },
    { case: "the end 07:00:00", changes: { quiet_end: "07:00:00" } },
    { case: "a missing activity_digest", changes: { activity_digest: undefined } },
    { case: "a repeated activity_digest", changes: { activity_digest: ["daily", "daily"] } },
    { case: "two different activity_digest values", changes: { activity_digest: ["hourly", "immediate"] } },
    { case: "the unknown interval weekly", changes: { activity_digest: "weekly" } },
    { case: "the interval in capitals", changes: { activity_digest: "Daily" } },
    { case: "the stored form daily@18:00 as a choice", changes: { activity_digest: "daily@18:00" } },
    { case: "an empty activity_digest", changes: { activity_digest: "" } },
    { case: "a daily digest without digest_time", changes: { digest_time: undefined } },
    { case: "a daily digest with a repeated digest_time", changes: { digest_time: ["06:45", "06:45"] } },
    { case: "a daily digest with an empty digest_time", changes: { digest_time: "" } },
    { case: "a daily digest at 24:00", changes: { digest_time: "24:00" } },
    { case: "a daily digest at 18:60", changes: { digest_time: "18:60" } },
    { case: "a daily digest at 6:00", changes: { digest_time: "6:00" } },
    { case: "a daily digest at 18:00:00", changes: { digest_time: "18:00:00" } },
    { case: "a start equal to the end", changes: { quiet_start: "07:00", quiet_end: "07:00" } },
  ])("parseSettingsForm rejects $case", ({ changes }) => {
    const settings = parseSettingsForm(fieldsWith(changes));

    expect(settings, "settings").toBeUndefined();
  });
});
