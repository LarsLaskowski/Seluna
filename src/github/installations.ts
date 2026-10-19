import type { AppCredentials } from "./app-credentials";
import type { GitHubFetch } from "./conversion";

export const MAX_INSTALLATIONS = 100;

export type InstallationAccount =
  | { readonly kind: "login"; readonly login: string; readonly type: string | undefined }
  | { readonly kind: "enterprise"; readonly slug: string }
  | { readonly kind: "unknown" };

export interface Installation {
  readonly id: number;
  readonly account: InstallationAccount;
  readonly repositorySelection: "all" | "selected";
  readonly suspended: boolean;
}

export type InstallationsResult =
  | { readonly kind: "listed"; readonly installations: readonly Installation[]; readonly more: boolean }
  | { readonly kind: "failed" };

/** The narrowed installations list, or `undefined` when any entry has another shape. */
export function parseInstallations(body: unknown): readonly Installation[] | undefined {
  void body;
  throw new Error("Not implemented");
}

/** Whether the `Link` header names a next page. */
export function hasNextPage(link: string | null): boolean {
  void link;
  throw new Error("Not implemented");
}

/** The app's first 100 installations. Never throws. */
export async function listInstallations(
  fetcher: GitHubFetch,
  version: string,
  now: Date,
  credentials: AppCredentials,
): Promise<InstallationsResult> {
  await Promise.resolve([fetcher, version, now, credentials]);
  throw new Error("Not implemented");
}
