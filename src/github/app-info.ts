import type { GitHubFetch } from "./conversion";
import { gitHubRequest, sendGitHub } from "./http";
import { APP_EVENTS, APP_PERMISSIONS } from "./manifest";
import { parseOwnerAccount } from "./owner";
import type { OwnerAccount } from "./owner";

const APP_SLUG = /^[a-z0-9-]{1,100}$/;
/** Permission levels from the lowest; a granted level satisfies every level up to its own. */
const LEVELS: readonly string[] = ["read", "write", "admin"];

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The granted access narrowed from an answer's `permissions` and `events`, or `undefined` when either has another shape. */
export function parseGrantedAccess(permissions: unknown, events: unknown): GrantedAccess | undefined {
  if (!isRecord(permissions) || !Array.isArray(events)) {
    return undefined;
  }
  const levels: Record<string, string> = {};
  for (const [name, level] of Object.entries(permissions)) {
    if (typeof level !== "string") {
      return undefined;
    }
    levels[name] = level;
  }
  const names: string[] = [];
  for (const event of events as unknown[]) {
    // `Array.isArray` narrows to `any[]`; the entries are narrowed one by one here.
    if (typeof event !== "string") {
      return undefined;
    }
    names.push(event);
  }
  return { permissions: levels, events: names };
}

/** The narrowed `GET /app` answer, or `undefined` when it has another shape. */
export function parseAppInfo(body: unknown): AppInfo | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  const { id, slug } = body;
  const access = parseGrantedAccess(body.permissions, body.events);
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1 || access === undefined) {
    return undefined;
  }
  return {
    appId: id,
    slug: typeof slug === "string" && APP_SLUG.test(slug) ? slug : undefined,
    owner: parseOwnerAccount(body.owner),
    access,
  };
}

/** Reads the app with `GET /app` signed with `jwt`. Never throws. */
export async function readAppInfo(fetcher: GitHubFetch, version: string, jwt: string): Promise<AppInfoResult> {
  const reply = await sendGitHub(fetcher, gitHubRequest("GET", "/app", version, jwt));
  const app = reply.kind === "ok" ? parseAppInfo(reply.body) : undefined;
  return app === undefined ? { kind: "failed" } : { kind: "read", app };
}

/** The rank of a level: 1 for `read` up to 3 for `admin`, 0 for an unknown one. */
function levelRank(level: string): number {
  return LEVELS.indexOf(level) + 1;
}

/** The granted level of `name` when it is the access's own entry. */
function grantedLevel(granted: GrantedAccess, name: string): string | undefined {
  return Object.hasOwn(granted.permissions, name) ? granted.permissions[name] : undefined;
}

/** Whether `granted` has the permission `name` at least at `level`. */
function satisfies(granted: GrantedAccess, name: string, level: string): boolean {
  const have = grantedLevel(granted, name);
  return have !== undefined && levelRank(have) > 0 && levelRank(have) >= levelRank(level);
}

/** What `granted` lacks against `wanted`: a level satisfies every lower one, an unknown level nothing. */
export function missingAccess(granted: GrantedAccess, wanted: GrantedAccess): MissingAccess {
  return {
    permissions: Object.entries(wanted.permissions)
      .filter(([name, level]) => !satisfies(granted, name, level))
      .map(([name]) => name),
    events: wanted.events.filter((event) => !granted.events.includes(event)),
  };
}

/** The access an installation is checked against: the manifest's, limited to what the app itself has. */
export function accessToCheck(app: GrantedAccess): GrantedAccess {
  return {
    permissions: Object.fromEntries(
      Object.entries(MANIFEST_ACCESS.permissions).filter(([name, level]) => satisfies(app, name, level)),
    ),
    events: MANIFEST_ACCESS.events.filter((event) => app.events.includes(event)),
  };
}

/** Whether anything is missing. */
export function hasMissing(missing: MissingAccess): boolean {
  return missing.permissions.length > 0 || missing.events.length > 0;
}
