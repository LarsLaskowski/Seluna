import { workerCredentials } from "../github/worker-secrets";
import type { NotificationSettings } from "../settings";
import { readLastDelivery, readAppSlug } from "../store/meta";
import { needsReset, readSecret } from "../store/secrets";
import { readNotificationSettings, readSetting, TELEGRAM_CHAT_ID_SETTING } from "../store/settings";
import { isChatIdSecretSet, parseChatId } from "../telegram";

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

const APP_ID_FORM = /^[1-9]\d{0,15}$/;

async function chatStatus(env: object, db: D1Database): Promise<ChatStatus> {
  if (isChatIdSecretSet(env)) {
    return { kind: "secret" };
  }
  const stored = await readSetting(db, TELEGRAM_CHAT_ID_SETTING);
  // A stored value that is not a chat id is shown as no saved chat.
  const chatId = stored === undefined ? undefined : parseChatId(stored);
  return chatId === undefined ? { kind: "none" } : { kind: "saved", chatId };
}

async function appStatus(env: object, db: D1Database, storageKey: CryptoKey): Promise<AppStatus> {
  const credentials = workerCredentials(env);
  if (credentials === "all") {
    return { kind: "worker-secrets" };
  }
  if (credentials === "partial") {
    return { kind: "partial-worker-secrets" };
  }
  const stored = await readSecret(db, storageKey, "github_app_id");
  switch (stored.kind) {
    case "ok": {
      // A stored value that is not an App ID is shown as no saved app.
      const appId = APP_ID_FORM.test(stored.value) ? Number(stored.value) : undefined;
      if (appId === undefined || !Number.isSafeInteger(appId)) {
        return { kind: "none" };
      }
      return { kind: "saved", appId, slug: await readAppSlug(db, appId) };
    }
    case "missing":
      return { kind: "none" };
    case "secret-changed":
    case "corrupt":
      return { kind: "unreadable" };
    default: {
      const unreachable: never = stored;
      return unreachable;
    }
  }
}

/** The status page's data. D1 errors are not caught. */
export async function statusView(
  env: object,
  db: D1Database,
  storageKey: CryptoKey,
  version: string,
): Promise<StatusView> {
  const settings = await readNotificationSettings(db);
  return {
    version,
    chat: await chatStatus(env, db),
    app: await appStatus(env, db, storageKey),
    lastDelivery: await readLastDelivery(db),
    resetNeeded: await needsReset(db, storageKey),
    settings,
  };
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}

/** The time in UTC, from the `getUTC*` fields. */
function utcText(time: Date): string {
  const year = String(time.getUTCFullYear()).padStart(4, "0");
  return `${year}-${two(time.getUTCMonth() + 1)}-${two(time.getUTCDate())} ${two(time.getUTCHours())}:${two(time.getUTCMinutes())} (UTC)`;
}

/**
 * `YYYY-MM-DD HH:MM (<timeZone>)`, 24-hour, in `timeZone`; when `Intl` throws for the zone or the time, the same
 * format in UTC built from the `getUTC*` fields, `(UTC)`. Never throws.
 */
export function formatDeliveryTime(time: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(time);
    const part = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((entry) => entry.type === type)?.value ?? "";
    const text = `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")} (${timeZone})`;
    return parts.some((entry) => entry.type === "year") ? text : utcText(time);
  } catch {
    return utcText(time);
  }
}
