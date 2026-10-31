import { DEFAULT_SETTINGS, canonicalTimeZone, isClockTime, RULE_IDS } from "../settings";
import type { ActivityDigest, NotificationSettings, QuietHours } from "../settings";

/** Path of the settings form's `POST`. */
export const SETTINGS_PATH = "/setup/settings";
/** Path of the reset form's `POST`. */
export const RESET_PATH = "/setup/reset";

/** The only value a checked checkbox posts. */
const CHECKED = "on";

/** The single value of `name`, or `undefined` when the field is absent or repeated. */
function single(fields: URLSearchParams, name: string): string | undefined {
  const values = fields.getAll(name);
  return values.length === 1 ? values[0] : undefined;
}

/** A checkbox: `false` when absent, `true` when posted once as `on`, `undefined` for anything else. */
function checkbox(fields: URLSearchParams, name: string): boolean | undefined {
  const values = fields.getAll(name);
  if (values.length === 0) {
    return false;
  }
  return values.length === 1 && values[0] === CHECKED ? true : undefined;
}

function quietHoursOf(fields: URLSearchParams): QuietHours | null | undefined {
  const on = checkbox(fields, "quiet_hours");
  if (on === undefined) {
    return undefined;
  }
  if (!on) {
    return null;
  }
  const start = single(fields, "quiet_start");
  const end = single(fields, "quiet_end");
  return start !== undefined && end !== undefined && isClockTime(start) && isClockTime(end) && start !== end
    ? { start, end }
    : undefined;
}

/** The digest of the form: `immediate` and `hourly` ignore a posted time, `daily` needs a valid one. */
function activityDigestOf(fields: URLSearchParams): ActivityDigest | undefined {
  const kind = single(fields, "activity_digest");
  if (kind === "immediate" || kind === "hourly") {
    return { kind };
  }
  const time = single(fields, "digest_time");
  return kind === "daily" && time !== undefined && isClockTime(time) ? { kind, time } : undefined;
}

/** The settings of a submitted settings form, or `undefined` when any field is invalid. */
export function parseSettingsForm(fields: URLSearchParams): NotificationSettings | undefined {
  const language = single(fields, "notification_language");
  const postedZone = single(fields, "time_zone");
  const timeZone = postedZone === undefined ? undefined : canonicalTimeZone(postedZone);
  const quietHours = quietHoursOf(fields);
  const updateNotice = checkbox(fields, "update_notice");
  const activityDigest = activityDigestOf(fields);
  if (
    (language !== "en" && language !== "de") ||
    timeZone === undefined ||
    quietHours === undefined ||
    updateNotice === undefined ||
    activityDigest === undefined
  ) {
    return undefined;
  }
  const rules = { ...DEFAULT_SETTINGS.rules };
  for (const id of RULE_IDS) {
    const enabled = checkbox(fields, `rule_${id}`);
    if (enabled === undefined) {
      return undefined;
    }
    rules[id] = enabled;
  }
  return {
    language,
    timeZone,
    quietHours: quietHours ?? undefined,
    rules,
    updateNotice,
    activityDigest,
  };
}
