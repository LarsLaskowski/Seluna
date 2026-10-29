import type { GitHubFetch } from "./conversion";
import { APP_EVENTS, APP_PERMISSIONS } from "./manifest";
import type { OwnerAccount } from "./owner";

/** The permissions (name to level) and events an app or an installation has been granted. */
export interface GrantedAccess {
  readonly permissions: Readonly<Record<string, string>>;
  readonly events: readonly string[];
}

/** What a granted access lacks against a wanted one, in manifest order. */
export interface MissingAccess {
  readonly permissions: readonly string[];
  readonly events: readonly string[];
}

/** The narrowed `GET /app` answer. */
export interface AppInfo {
  readonly appId: number;
  readonly slug: string | undefined;
  readonly owner: OwnerAccount | undefined;
  readonly access: GrantedAccess;
}

export type AppInfoResult = { readonly kind: "read"; readonly app: AppInfo } | { readonly kind: "failed" };

/** The access the manifest asks for. */
export const MANIFEST_ACCESS: GrantedAccess = { permissions: APP_PERMISSIONS, events: APP_EVENTS };

/** The granted access narrowed from an answer's `permissions` and `events`, or `undefined` when either has another shape. */
export function parseGrantedAccess(permissions: unknown, events: unknown): GrantedAccess | undefined {
  throw new Error("Not implemented");
}

/** The narrowed `GET /app` answer, or `undefined` when it has another shape. */
export function parseAppInfo(body: unknown): AppInfo | undefined {
  throw new Error("Not implemented");
}

/** Reads the app with `GET /app` signed with `jwt`. Never throws. */
export function readAppInfo(fetcher: GitHubFetch, version: string, jwt: string): Promise<AppInfoResult> {
  throw new Error("Not implemented");
}

/** What `granted` lacks against `wanted`: a level satisfies every lower one, an unknown level nothing. */
export function missingAccess(granted: GrantedAccess, wanted: GrantedAccess): MissingAccess {
  throw new Error("Not implemented");
}

/** The access an installation is checked against: the manifest's, limited to what the app itself has. */
export function accessToCheck(app: GrantedAccess): GrantedAccess {
  throw new Error("Not implemented");
}

/** Whether anything is missing. */
export function hasMissing(missing: MissingAccess): boolean {
  throw new Error("Not implemented");
}
