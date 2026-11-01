import type { InstallationAccount } from "./installations";
import { isAccountName } from "./manifest";
import type { OwnerAccount } from "./owner";

const GITHUB_ORIGIN = "https://github.com";
const APP_SLUG = /^[a-z0-9-]{1,100}$/;

function isInstallationId(id: number): boolean {
  return Number.isSafeInteger(id) && id >= 1;
}

/** The GitHub page where the owner changes the app's permissions, or `undefined` when no safe URL can be built. */
export function appPermissionsUrl(owner: OwnerAccount, slug: string): string | undefined {
  if (!APP_SLUG.test(slug)) {
    return undefined;
  }
  if (owner.type === "User") {
    return `${GITHUB_ORIGIN}/settings/apps/${slug}/permissions`;
  }
  return isAccountName(owner.login)
    ? `${GITHUB_ORIGIN}/organizations/${owner.login}/settings/apps/${slug}/permissions`
    : undefined;
}

/** The GitHub page where an installation's new permissions are reviewed, or `undefined` when no safe URL can be built. */
export function installationSettingsUrl(account: InstallationAccount, installationId: number): string | undefined {
  if (account.kind !== "login" || !isInstallationId(installationId) || !isAccountName(account.login)) {
    return undefined;
  }
  switch (account.type) {
    case "User":
      return `${GITHUB_ORIGIN}/settings/installations/${String(installationId)}`;
    case "Organization":
      return `${GITHUB_ORIGIN}/organizations/${account.login}/settings/installations/${String(installationId)}`;
    default:
      return undefined;
  }
}
