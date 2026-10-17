import { describe, expect, it } from "vitest";
import { RULE_IDS } from "../settings";
import { parseSettingsForm } from "./settings-form";

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
      },
      updateNotice: true,
    });
  });

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
    { case: "a time zone in lower case", changes: { time_zone: "europe/berlin" } },
    { case: "the checkbox value 1", changes: { update_notice: "1" } },
    { case: "the checkbox value 1 of quiet_hours", changes: { quiet_hours: "1" } },
    { case: "a repeated rule checkbox", changes: { rule_ci_failed_pull_request: ["on", "on"] } },
    { case: "quiet hours without quiet_start", changes: { quiet_start: undefined } },
    { case: "quiet hours without quiet_end", changes: { quiet_end: undefined } },
    { case: "a repeated quiet_start", changes: { quiet_start: ["22:00", "22:00"] } },
    { case: "the start 24:00", changes: { quiet_start: "24:00" } },
    { case: "the start 7:00", changes: { quiet_start: "7:00" } },
    { case: "the end 07:00:00", changes: { quiet_end: "07:00:00" } },
    { case: "a start equal to the end", changes: { quiet_start: "07:00", quiet_end: "07:00" } },
  ])("parseSettingsForm rejects $case", ({ changes }) => {
    const settings = parseSettingsForm(fieldsWith(changes));

    expect(settings, "settings").toBeUndefined();
  });
});
