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
  },
  updateNotice: true,
};

/** The `settings` keys of this module, in a fixed order. */
export const SETTING_KEYS: readonly string[] = [];

/** The time zone names the runtime lists, with `UTC` added when missing. */
export function timeZones(): readonly string[] {
  throw new Error("Not implemented");
}

/** Whether `value` is exactly a member of `timeZones()`. */
export function isTimeZone(value: string): boolean {
  throw new Error("Not implemented");
}

/** Whether `value` is a 24-hour `HH:MM` time. */
export function isClockTime(value: string): boolean {
  throw new Error("Not implemented");
}

/** The settings of the stored `settings` rows; an absent or invalid row reads as its default. */
export function settingsFromStored(stored: ReadonlyMap<string, string>): NotificationSettings {
  throw new Error("Not implemented");
}

/** The `settings` rows (key and value) that store `settings`. */
export function settingsToStored(settings: NotificationSettings): readonly (readonly [key: string, value: string])[] {
  throw new Error("Not implemented");
}
