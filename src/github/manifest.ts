/** Whether the app belongs to a personal account or to an organization. */
export type AccountType = "personal" | "organization";

/** The account the owner chose; carried in the signed state. */
export interface AccountChoice {
  readonly type: AccountType;
  readonly account: string;
}

export const SELUNA_HOMEPAGE = "https://github.com/LarsLaskowski/Seluna";
export const MAX_APP_NAME_CHARACTERS = 34;
export const APP_PERMISSIONS: Readonly<Record<string, "read">> = {};
export const APP_EVENTS: readonly string[] = [];

/** The manifest GitHub's app creation page receives. */
export interface AppManifest {
  readonly name: string;
  readonly url: string;
  readonly hook_attributes: { readonly url: string; readonly active: true };
  readonly redirect_url: string;
  readonly public: false;
  readonly default_permissions: Readonly<Record<string, "read">>;
  readonly default_events: readonly string[];
}

/** The account type named by `text` (exactly `personal` or `organization`), else `undefined`. */
export function parseAccountType(_text: string): AccountType | undefined {
  throw new Error("Not implemented");
}

/** Whether `text` is a GitHub account name of 1 to 39 letters, digits and inner hyphens. */
export function isAccountName(_text: string): boolean {
  throw new Error("Not implemented");
}

/** `seluna-<account>` cut to its first 34 characters. */
export function appName(_account: string): string {
  throw new Error("Not implemented");
}

/** The manifest of the app; `origin` without a trailing slash, e.g. `https://seluna.example.workers.dev`. */
export function appManifest(_origin: string, _account: string): AppManifest {
  throw new Error("Not implemented");
}

/** The URL the manifest form posts to for a personal account or an organization, carrying the state. */
export function manifestFormAction(_type: AccountType, _account: string, _state: string): string {
  throw new Error("Not implemented");
}
