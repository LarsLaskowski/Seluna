/** `meta` key of the time of the last received delivery (decimal milliseconds since 1970-01-01 UTC). */
export const LAST_DELIVERY_META_KEY = "last_delivery";
/** `meta` key of the GitHub App slug, stored as `<appId>:<slug>`. */
export const GITHUB_APP_SLUG_META_KEY = "github_app_slug";

const LAST_DELIVERY_FORM = /^(?:0|[1-9]\d{0,15})$/;
const SLUG_FORM = /^(\d{1,16}):([a-z0-9-]{1,100})$/;
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

/** Upsert of `last_delivery` with `time`, for a batch. */
export function lastDeliveryUpsert(db: D1Database, time: Date): D1PreparedStatement {
  return db
    .prepare("INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(LAST_DELIVERY_META_KEY, String(time.getTime()));
}
