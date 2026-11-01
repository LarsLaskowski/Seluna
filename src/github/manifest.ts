/** Whether the app belongs to a personal account or to an organization. */
export type AccountType = "personal" | "organization";

/** The account the owner chose; carried in the signed state. */
export interface AccountChoice {
  readonly type: AccountType;
  readonly account: string;
}

export const SELUNA_HOMEPAGE = "https://github.com/LarsLaskowski/Seluna";
export const MAX_APP_NAME_CHARACTERS = 34;
export const APP_PERMISSIONS: Readonly<Record<string, "read">> = {
  actions: "read",
  contents: "read",
  issues: "read",
  pull_requests: "read",
  vulnerability_alerts: "read",
  security_events: "read",
  secret_scanning_alerts: "read",
  metadata: "read",
};
export const APP_EVENTS: readonly string[] = [
  "pull_request",
  "workflow_run",
  "dependabot_alert",
  "code_scanning_alert",
  "secret_scanning_alert",
  "issues",
  "issue_comment",
  "fork",
  "star",
];

const ACCOUNT_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

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
export function parseAccountType(text: string): AccountType | undefined {
  return text === "personal" || text === "organization" ? text : undefined;
}

/** Whether `text` is a GitHub account name of 1 to 39 letters, digits and inner hyphens. */
export function isAccountName(text: string): boolean {
  return ACCOUNT_NAME.test(text);
}

/** `seluna-<account>` cut to its first 34 characters. */
export function appName(account: string): string {
  return `seluna-${account}`.slice(0, MAX_APP_NAME_CHARACTERS);
}

/** The manifest of the app; `origin` without a trailing slash, e.g. `https://seluna.example.workers.dev`. */
export function appManifest(origin: string, account: string): AppManifest {
  return {
    name: appName(account),
    url: SELUNA_HOMEPAGE,
    hook_attributes: { url: `${origin}/webhook`, active: true },
    redirect_url: `${origin}/setup/github/callback`,
    public: false,
    default_permissions: APP_PERMISSIONS,
    default_events: APP_EVENTS,
  };
}

/** The URL the manifest form posts to for a personal account or an organization, carrying the state. */
export function manifestFormAction(type: AccountType, account: string, state: string): string {
  const base =
    type === "personal"
      ? "https://github.com/settings/apps/new"
      : `https://github.com/organizations/${account}/settings/apps/new`;
  return `${base}?state=${state}`;
}
