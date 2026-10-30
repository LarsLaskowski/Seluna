import type { Language } from "./setup/language";

/** The ids of the notification rules, in the order of the settings form. */
export const RULE_IDS = [
  "pull_request_opened",
  "pull_request_ready_for_review",
  "pull_request_review_requested",
  "ci_failed_default_branch",
  "ci_failed_pull_request",
  "dependabot_alert",
  "code_scanning_alert",
  "secret_scanning_alert",
  "issue_opened",
  "issue_comment",
  "pull_request_comment",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

/** Quiet hours as `HH:MM` (24-hour) times; `start` differs from `end`. */
export interface QuietHours {
  readonly start: string;
  readonly end: string;
}

export interface NotificationSettings {
  readonly language: Language;
  readonly timeZone: string;
  readonly quietHours: QuietHours | undefined;
  readonly rules: Readonly<Record<RuleId, boolean>>;
  readonly updateNotice: boolean;
}

/** The settings of an instance whose owner changed nothing. */
export const DEFAULT_SETTINGS: NotificationSettings = {
  language: "en",
  timeZone: "UTC",
  quietHours: undefined,
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
  },
  updateNotice: true,
};

const LANGUAGE_KEY = "notification_language";
const TIME_ZONE_KEY = "time_zone";
const QUIET_HOURS_KEY = "quiet_hours";
const UPDATE_NOTICE_KEY = "update_notice";
const QUIET_HOURS_OFF = "off";
const SWITCH_ON = "on";
const SWITCH_OFF = "off";
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** The `settings` key of a rule's switch. */
function ruleKey(id: RuleId): string {
  return `rule_${id}`;
}

/** The `settings` keys of this module, in a fixed order. */
export const SETTING_KEYS: readonly string[] = [
  LANGUAGE_KEY,
  TIME_ZONE_KEY,
  QUIET_HOURS_KEY,
  ...RULE_IDS.map((id) => ruleKey(id)),
  UPDATE_NOTICE_KEY,
];

/** The time zone names the runtime lists, with `UTC` added when missing. */
export function timeZones(): readonly string[] {
  let listed: readonly string[] = [];
  try {
    listed = Intl.supportedValuesOf("timeZone");
  } catch {
    // The runtime has no list: only UTC remains.
  }
  return listed.includes("UTC") ? listed : ["UTC", ...listed];
}

/** Whether `value` is exactly a member of `timeZones()`. */
export function isTimeZone(value: string): boolean {
  return timeZones().includes(value);
}

/** Whether `value` is a 24-hour `HH:MM` time. */
export function isClockTime(value: string): boolean {
  return CLOCK_TIME.test(value);
}

function quietHoursFromStored(value: string | undefined): QuietHours | undefined {
  const parts = value?.split("-");
  const start = parts?.[0];
  const end = parts?.[1];
  if (parts?.length !== 2 || start === undefined || end === undefined) {
    return undefined;
  }
  return isClockTime(start) && isClockTime(end) && start !== end ? { start, end } : undefined;
}

function switchFromStored(value: string | undefined, fallback: boolean): boolean {
  if (value === SWITCH_ON) {
    return true;
  }
  return value === SWITCH_OFF ? false : fallback;
}

/** The settings of the stored `settings` rows; an absent or invalid row reads as its default. */
export function settingsFromStored(stored: ReadonlyMap<string, string>): NotificationSettings {
  const language = stored.get(LANGUAGE_KEY);
  const timeZone = stored.get(TIME_ZONE_KEY);
  const rules = { ...DEFAULT_SETTINGS.rules };
  for (const id of RULE_IDS) {
    rules[id] = switchFromStored(stored.get(ruleKey(id)), DEFAULT_SETTINGS.rules[id]);
  }
  return {
    language: language === "en" || language === "de" ? language : DEFAULT_SETTINGS.language,
    timeZone: timeZone !== undefined && isTimeZone(timeZone) ? timeZone : DEFAULT_SETTINGS.timeZone,
    quietHours: quietHoursFromStored(stored.get(QUIET_HOURS_KEY)),
    rules,
    updateNotice: switchFromStored(stored.get(UPDATE_NOTICE_KEY), DEFAULT_SETTINGS.updateNotice),
  };
}

function switchText(on: boolean): string {
  return on ? SWITCH_ON : SWITCH_OFF;
}

/** The `settings` rows (key and value) that store `settings`. */
export function settingsToStored(settings: NotificationSettings): readonly (readonly [key: string, value: string])[] {
  const { quietHours } = settings;
  return [
    [LANGUAGE_KEY, settings.language],
    [TIME_ZONE_KEY, settings.timeZone],
    [QUIET_HOURS_KEY, quietHours === undefined ? QUIET_HOURS_OFF : `${quietHours.start}-${quietHours.end}`],
    ...RULE_IDS.map((id): readonly [string, string] => [ruleKey(id), switchText(settings.rules[id])]),
    [UPDATE_NOTICE_KEY, switchText(settings.updateNotice)],
  ];
}
