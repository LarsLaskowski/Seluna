import type { NotificationSettings } from "../settings";

/** Path of the settings form's `POST`. */
export const SETTINGS_PATH = "/setup/settings";
/** Path of the reset form's `POST`. */
export const RESET_PATH = "/setup/reset";

/** The settings of a submitted settings form, or `undefined` when any field is invalid. */
export function parseSettingsForm(fields: URLSearchParams): NotificationSettings | undefined {
  throw new Error("Not implemented");
}
