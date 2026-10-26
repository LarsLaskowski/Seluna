import { resolveBotToken } from "../bot-token";
import type { ChannelList } from "../channels/channel";
import { CHANNELS, readActiveChannel } from "../channels/registry";
import { parseAppId, resolveAppCredentials } from "../github/app-credentials";
import type { GitHubFetch } from "../github/conversion";
import { listInstallations } from "../github/installations";
import type { Installation } from "../github/installations";
import { workerCredentials } from "../github/worker-secrets";
import type { NotificationSettings } from "../settings";
import { readLastDelivery, readAppSlug } from "../store/meta";
import { needsReset, readSecret } from "../store/secrets";
import { readNotificationSettings, readSetting, TELEGRAM_CHAT_ID_SETTING } from "../store/settings";
import { isChatIdSecretSet, parseChatId } from "../telegram";

export type ChatStatus =
  { readonly kind: "secret" } | { readonly kind: "saved"; readonly chatId: number } | { readonly kind: "none" };

export type BotTokenStatus = "worker-secret" | "saved" | "none" | "unreadable";

export type AppStatus =
  | { readonly kind: "worker-secrets" }
  | { readonly kind: "partial-worker-secrets" }
  | { readonly kind: "saved"; readonly appId: number; readonly slug: string | undefined }
  | { readonly kind: "none" }
  | { readonly kind: "unreadable" };

export type InstallationsView =
  | { readonly kind: "hidden" }
  | { readonly kind: "listed"; readonly installations: readonly Installation[]; readonly more: boolean }
  | { readonly kind: "unavailable" }
  | { readonly kind: "key-unusable" };

/** What the status page needs to ask GitHub for the installations. */
export interface StatusGitHub {
  readonly fetcher: GitHubFetch;
  readonly now: () => Date;
}

/** One messenger on the start page. */
export interface MessengerEntry {
  readonly id: string;
  readonly name: string;
  readonly setupPath: string;
  readonly configured: boolean;
  readonly active: boolean;
  readonly removable: boolean;
}

/** The messengers in registry order and the active one. */
export interface MessengersView {
  readonly entries: readonly MessengerEntry[];
  readonly active: MessengerEntry;
}

/** The messengers card's data. D1 errors are not caught. */
export async function messengersView(env: object, db: D1Database, channels: ChannelList): Promise<MessengersView> {
  const activeId = (await readActiveChannel(db, channels)).id;
  const entries: MessengerEntry[] = [];
  for (const channel of channels) {
    entries.push({
      id: channel.id,
      name: channel.displayName,
      setupPath: channel.setupPath,
      configured: (await channel.prepare(env, db)).kind === "ready",
      active: channel.id === activeId,
      removable: await channel.hasRemovableCredentials(env, db),
    });
  }
  const active = entries.find((entry) => entry.active) ?? entries[0];
  if (active === undefined) {
    throw new TypeError("No messenger is registered");
  }
  return { entries, active };
}

export interface StatusView {
  readonly version: string;
  readonly botToken: BotTokenStatus;
  readonly chat: ChatStatus;
  readonly app: AppStatus;
  readonly lastDelivery: Date | undefined;
  readonly resetNeeded: boolean;
  readonly settings: NotificationSettings;
  readonly installations: InstallationsView;
  readonly messengers: MessengersView;
}

/** Where the bot token comes from, read from the environment and D1; calls no Telegram API. D1 errors are not caught. */
async function botTokenStatus(env: object, db: D1Database): Promise<BotTokenStatus> {
  const resolved = await resolveBotToken(env, db);
  switch (resolved.kind) {
    case "usable":
      return resolved.source === "worker-secret" ? "worker-secret" : "saved";
    case "malformed":
      return "worker-secret";
    case "missing":
      return "none";
    case "unreadable":
    case "damaged":
      return "unreadable";
    default: {
      const unreachable: never = resolved;
      return unreachable;
    }
  }
}

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
      const appId = parseAppId(stored.value);
      if (appId === undefined) {
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

/** The installations the status page lists; GitHub is asked only for an app its _GitHub App:_ line names. */
async function installationsView(
  env: object,
  db: D1Database,
  version: string,
  github: StatusGitHub,
  app: AppStatus,
): Promise<InstallationsView> {
  if (app.kind !== "worker-secrets" && app.kind !== "saved") {
    return { kind: "hidden" };
  }
  const resolved = await resolveAppCredentials(env, db);
  switch (resolved.kind) {
    case "no-app":
      return { kind: "unavailable" };
    case "key-unusable":
      return { kind: "key-unusable" };
    case "ok": {
      const listed = await listInstallations(github.fetcher, version, github.now(), resolved.credentials);
      return listed.kind === "listed"
        ? { kind: "listed", installations: listed.installations, more: listed.more }
        : { kind: "unavailable" };
    }
    default: {
      const unreachable: never = resolved;
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
  github: StatusGitHub,
  channels: ChannelList = CHANNELS,
): Promise<StatusView> {
  const settings = await readNotificationSettings(db);
  const botToken = await botTokenStatus(env, db);
  const chat = await chatStatus(env, db);
  const app = await appStatus(env, db, storageKey);
  return {
    version,
    botToken,
    chat,
    app,
    lastDelivery: await readLastDelivery(db),
    resetNeeded: await needsReset(db, storageKey),
    settings,
    installations: await installationsView(env, db, version, github, app),
    messengers: await messengersView(env, db, channels),
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
