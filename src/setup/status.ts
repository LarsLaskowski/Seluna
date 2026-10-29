import { resolveBotToken } from "../bot-token";
import type { ChannelList } from "../channels/channel";
import { CHANNELS, readActiveChannel } from "../channels/registry";
import { accessToCheck, hasMissing, MANIFEST_ACCESS, missingAccess, readAppInfo } from "../github/app-info";
import type { AppInfo, MissingAccess } from "../github/app-info";
import { appPermissionsUrl, installationSettingsUrl } from "../github/app-links";
import { parseAppId, resolveAppCredentials } from "../github/app-credentials";
import { appJwt } from "../github/app-jwt";
import type { GitHubFetch } from "../github/conversion";
import { listInstallations } from "../github/installations";
import type { Installation } from "../github/installations";
import type { OwnerAccount } from "../github/owner";
import { APP_ID_SECRET_NAME, workerCredentials } from "../github/worker-secrets";
import type { NotificationSettings } from "../settings";
import { readAppOwner, readAppSlug, readLastDelivery, writeAppOwner } from "../store/meta";
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

/** The owner line of the status page. */
export type OwnerView =
  | { readonly kind: "hidden" }
  | { readonly kind: "known"; readonly owner: OwnerAccount }
  | { readonly kind: "unavailable" };

/** The app's own permissions and events checked against the manifest's. */
export type AppAccessView =
  | { readonly kind: "hidden" }
  | { readonly kind: "unchecked" }
  | { readonly kind: "checked"; readonly missing: MissingAccess; readonly settingsUrl: string | undefined };

/** An installation's permissions and events checked against the app's. */
export type InstallationCheck =
  | { readonly kind: "complete" }
  | { readonly kind: "missing"; readonly missing: MissingAccess; readonly acceptUrl: string | undefined }
  | { readonly kind: "unreadable" }
  | { readonly kind: "app-unchecked" };

export interface InstallationEntry {
  readonly installation: Installation;
  readonly check: InstallationCheck;
}

export type InstallationsView =
  | { readonly kind: "hidden" }
  | { readonly kind: "listed"; readonly installations: readonly InstallationEntry[]; readonly more: boolean }
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
  const entries: readonly MessengerEntry[] = await Promise.all(
    channels.map(async (channel): Promise<MessengerEntry> => ({
      id: channel.id,
      name: channel.displayName,
      setupPath: channel.setupPath,
      configured: (await channel.prepare(env, db)).kind === "ready",
      active: channel.id === activeId,
      removable: await channel.hasRemovableCredentials(env, db),
    })),
  );
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
  readonly owner: OwnerView;
  readonly appAccess: AppAccessView;
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

/** What the status page learned from GitHub about the app: the three views that depend on it. */
interface AppView {
  readonly installations: InstallationsView;
  readonly owner: OwnerView;
  readonly appAccess: AppAccessView;
}

/** The App ID the _GitHub App:_ line names, for the owner stored beside it. */
function namedAppId(env: object, app: AppStatus): number | undefined {
  if (app.kind === "saved") {
    return app.appId;
  }
  const text: unknown = Reflect.get(env, APP_ID_SECRET_NAME);
  return typeof text === "string" ? parseAppId(text) : undefined;
}

/** The stored owner of `appId` as the owner line, else _unavailable_. D1 errors are not caught. */
async function storedOwnerView(db: D1Database, appId: number | undefined): Promise<OwnerView> {
  const stored = appId === undefined ? undefined : await readAppOwner(db, appId);
  return stored === undefined ? { kind: "unavailable" } : { kind: "known", owner: stored };
}

function sameOwner(first: OwnerAccount, second: OwnerAccount | undefined): boolean {
  return second?.id === first.id && second.login === first.login && second.type === first.type;
}

/** Stores the owner GitHub named when it differs from the stored one; a failure is dropped. */
async function keepOwner(db: D1Database, appId: number, owner: OwnerAccount): Promise<void> {
  try {
    if (!sameOwner(owner, await readAppOwner(db, appId))) {
      await writeAppOwner(db, appId, owner);
    }
  } catch {
    // The error is deliberately dropped: the page is answered with the owner GitHub named.
  }
}

/** The check of one installation against what the app itself has. */
function installationCheck(installation: Installation, app: AppInfo | undefined): InstallationCheck {
  if (app === undefined) {
    return { kind: "app-unchecked" };
  }
  if (installation.access === undefined) {
    return { kind: "unreadable" };
  }
  const missing = missingAccess(installation.access, accessToCheck(app.access));
  return hasMissing(missing)
    ? { kind: "missing", missing, acceptUrl: installationSettingsUrl(installation.account, installation.id) }
    : { kind: "complete" };
}

/** The views of an app whose credentials work: one JWT, `GET /app` and the installations list asked in parallel. */
async function checkedAppView(
  db: D1Database,
  version: string,
  github: StatusGitHub,
  appId: number,
  jwt: string,
): Promise<AppView> {
  const [read, listed] = await Promise.all([
    readAppInfo(github.fetcher, version, jwt),
    listInstallations(github.fetcher, version, jwt),
  ]);
  // An answer for another App ID counts as failed.
  const info = read.kind === "read" && read.app.appId === appId ? read.app : undefined;
  let owner: OwnerView;
  if (info?.owner === undefined) {
    owner = await storedOwnerView(db, appId);
  } else {
    await keepOwner(db, appId, info.owner);
    owner = { kind: "known", owner: info.owner };
  }
  const installations: InstallationsView =
    listed.kind === "listed"
      ? {
          kind: "listed",
          installations: listed.installations.map((installation) => ({
            installation,
            check: installationCheck(installation, info),
          })),
          more: listed.more,
        }
      : { kind: "unavailable" };
  if (info === undefined) {
    return { installations, owner, appAccess: { kind: "unchecked" } };
  }
  const slug = info.slug ?? (await readAppSlug(db, appId));
  return {
    installations,
    owner,
    appAccess: {
      kind: "checked",
      missing: missingAccess(info.access, MANIFEST_ACCESS),
      settingsUrl: owner.kind === "known" && slug !== undefined ? appPermissionsUrl(owner.owner, slug) : undefined,
    },
  };
}

/** The installations the status page lists, with the owner and the app check; GitHub is asked only for an app its _GitHub App:_ line names. */
async function appView(
  env: object,
  db: D1Database,
  version: string,
  github: StatusGitHub,
  app: AppStatus,
): Promise<AppView> {
  if (app.kind !== "worker-secrets" && app.kind !== "saved") {
    return { installations: { kind: "hidden" }, owner: { kind: "hidden" }, appAccess: { kind: "hidden" } };
  }
  const resolved = await resolveAppCredentials(env, db);
  const unchecked = async (installations: InstallationsView): Promise<AppView> => ({
    installations,
    owner: await storedOwnerView(db, resolved.kind === "ok" ? resolved.credentials.appId : namedAppId(env, app)),
    appAccess: { kind: "unchecked" },
  });
  switch (resolved.kind) {
    case "no-app":
      return unchecked({ kind: "unavailable" });
    case "key-unusable":
      return unchecked({ kind: "key-unusable" });
    case "ok": {
      let jwt: string;
      try {
        jwt = await appJwt(resolved.credentials.signingKey, resolved.credentials.appId, github.now());
      } catch {
        // Signing failures carry nothing the caller can use; the cause is dropped.
        return unchecked({ kind: "unavailable" });
      }
      return checkedAppView(db, version, github, resolved.credentials.appId, jwt);
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
    ...(await appView(env, db, version, github, app)),
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
