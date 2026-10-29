/** The permissions an installation token is narrowed to: the only call made with it is the pull request read. */
export const INSTALLATION_TOKEN_PERMISSIONS: Readonly<Record<string, "read">> = {
  metadata: "read",
  pull_requests: "read",
};

/** The permissions as sorted `name=level` pairs joined by commas, the form bound into a cached token's additional data. */
export function permissionsTag(permissions: Readonly<Record<string, string>>): string {
  throw new Error("Not implemented");
}
