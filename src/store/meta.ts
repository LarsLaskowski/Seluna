/** `meta` key of the time of the last received delivery (decimal milliseconds since 1970-01-01 UTC). */
export const LAST_DELIVERY_META_KEY = "last_delivery";
/** `meta` key of the GitHub App slug, stored as `<appId>:<slug>`. */
export const GITHUB_APP_SLUG_META_KEY = "github_app_slug";

/** The time of the last received delivery, or `undefined` when absent or not a valid time. D1 errors are not caught. */
export async function readLastDelivery(db: D1Database): Promise<Date | undefined> {
  throw new Error("Not implemented");
}

/** The stored slug when it belongs to `appId`, or `undefined`. D1 errors are not caught. */
export async function readAppSlug(db: D1Database, appId: number): Promise<string | undefined> {
  throw new Error("Not implemented");
}

/** Stores `slug` for `appId`, replacing an earlier one. D1 errors are not caught. */
export async function writeAppSlug(db: D1Database, appId: number, slug: string): Promise<void> {
  throw new Error("Not implemented");
}
