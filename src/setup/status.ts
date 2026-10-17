import type { NotificationSettings } from "../settings";

export type ChatStatus =
  { readonly kind: "secret" } | { readonly kind: "saved"; readonly chatId: number } | { readonly kind: "none" };

export type AppStatus =
  | { readonly kind: "worker-secrets" }
  | { readonly kind: "partial-worker-secrets" }
  | { readonly kind: "saved"; readonly appId: number; readonly slug: string | undefined }
  | { readonly kind: "none" }
  | { readonly kind: "unreadable" };

export interface StatusView {
  readonly version: string;
  readonly chat: ChatStatus;
  readonly app: AppStatus;
  readonly lastDelivery: Date | undefined;
  readonly resetNeeded: boolean;
  readonly settings: NotificationSettings;
}

/** The status page's data. D1 errors are not caught. */
export async function statusView(
  env: object,
  db: D1Database,
  storageKey: CryptoKey,
  version: string,
): Promise<StatusView> {
  throw new Error("Not implemented");
}

/**
 * `YYYY-MM-DD HH:MM (<timeZone>)`, 24-hour, in `timeZone`; when `Intl` throws for the zone or the time, the same
 * format in UTC built from the `getUTC*` fields, `(UTC)`. Never throws.
 */
export function formatDeliveryTime(time: Date, timeZone: string): string {
  throw new Error("Not implemented");
}
