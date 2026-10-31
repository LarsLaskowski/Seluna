import { parseOwnerAccount } from "../github/owner";
import type { OwnerAccount } from "../github/owner";

/** `meta` key of the time of the last received delivery (decimal milliseconds since 1970-01-01 UTC). */
export const LAST_DELIVERY_META_KEY = "last_delivery";
/** `meta` key of the GitHub App slug, stored as `<appId>:<slug>`. */
export const GITHUB_APP_SLUG_META_KEY = "github_app_slug";
/** `meta` key of the GitHub App owner, stored as `<appId>:<ownerId>:<type>:<login>`. */
export const GITHUB_APP_OWNER_META_KEY = "github_app_owner";

/** `meta` key of the time of the last activity digest run (decimal milliseconds since 1970-01-01 UTC). */
export const DIGEST_RUN_META_KEY = "activity_digest_run";

const LAST_DELIVERY_FORM = /^(?:0|[1-9]\d{0,15})$/;
const SLUG_FORM = /^(\d{1,16}):([a-z0-9-]{1,100})$/;
const OWNER_FORM = /^(\d{1,16}):([1-9]\d{0,15}):([A-Za-z]{1,20}):([^:]{1,100})$/;
/** The latest time a JavaScript `Date` holds, in milliseconds. */
const MAX_TIME = 8_640_000_000_000_000;

async function readMeta(db: D1Database, key: string): Promise<string | undefined> {
  const row = await db.prepare("SELECT value FROM meta WHERE key = ?1").bind(key).first();
  const value = row?.value;
  return typeof value === "string" ? value : undefined;
}

/** The time of the last received delivery, or `undefined` when absent or not a valid time. D1 errors are not caught. */
export async function readLastDelivery(db: D1Database): Promise<Date | undefined> {
  const stored = await readMeta(db, LAST_DELIVERY_META_KEY);
  if (stored === undefined || !LAST_DELIVERY_FORM.test(stored)) {
    return undefined;
  }
  const milliseconds = Number(stored);
  return milliseconds <= MAX_TIME ? new Date(milliseconds) : undefined;
}

/** The stored slug when it belongs to `appId`, or `undefined`. D1 errors are not caught. */
export async function readAppSlug(db: D1Database, appId: number): Promise<string | undefined> {
  const stored = await readMeta(db, GITHUB_APP_SLUG_META_KEY);
  const match = stored === undefined ? null : SLUG_FORM.exec(stored);
  return match?.[1] === String(appId) ? match[2] : undefined;
}

/** Stores `slug` for `appId`, replacing an earlier one. D1 errors are not caught. */
export async function writeAppSlug(db: D1Database, appId: number, slug: string): Promise<void> {
  await db
    .prepare("INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(GITHUB_APP_SLUG_META_KEY, `${String(appId)}:${slug}`)
    .run();
}

/** The stored owner when it belongs to `appId` and every part is valid, or `undefined`. D1 errors are not caught. */
export async function readAppOwner(db: D1Database, appId: number): Promise<OwnerAccount | undefined> {
  const stored = await readMeta(db, GITHUB_APP_OWNER_META_KEY);
  const match = stored === undefined ? null : OWNER_FORM.exec(stored);
  if (match?.[1] !== String(appId)) {
    return undefined;
  }
  return parseOwnerAccount({ id: Number(match[2]), type: match[3], login: match[4] });
}

/** Stores `owner` for `appId`, replacing an earlier one. D1 errors are not caught. */
export async function writeAppOwner(db: D1Database, appId: number, owner: OwnerAccount): Promise<void> {
  await db
    .prepare("INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(GITHUB_APP_OWNER_META_KEY, `${String(appId)}:${String(owner.id)}:${owner.type}:${owner.login}`)
    .run();
}

/** Upsert of `last_delivery` with `time`, for a batch. */
export function lastDeliveryUpsert(db: D1Database, time: Date): D1PreparedStatement {
  return db
    .prepare("INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(LAST_DELIVERY_META_KEY, String(time.getTime()));
}

/* eslint-disable @typescript-eslint/no-unused-vars -- skeleton: the bodies arrive with the implementation */
/** The time of the last activity digest run, or `undefined` when absent or not a valid time. D1 errors are not caught. */
export function readDigestRun(db: D1Database): Promise<Date | undefined> {
  return Promise.reject(new Error("not implemented"));
}

/** Upsert of `activity_digest_run` with `time`, for a batch. */
export function digestRunUpsert(db: D1Database, time: Date): D1PreparedStatement {
  throw new Error("not implemented");
}
