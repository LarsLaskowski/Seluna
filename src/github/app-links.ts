import type { InstallationAccount } from "./installations";
import type { OwnerAccount } from "./owner";

/** The GitHub page where the owner changes the app's permissions, or `undefined` when no safe URL can be built. */
export function appPermissionsUrl(owner: OwnerAccount, slug: string): string | undefined {
  throw new Error("Not implemented");
}

/** The GitHub page where an installation's new permissions are reviewed, or `undefined` when no safe URL can be built. */
export function installationSettingsUrl(account: InstallationAccount, installationId: number): string | undefined {
  throw new Error("Not implemented");
}
