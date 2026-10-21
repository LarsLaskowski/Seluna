import { deliverMessages } from "./delivery";
import type { DeliveryDeps } from "./delivery";
import { fetchLatestRelease, UPSTREAM_REPOSITORY } from "./github/release";
import type { GitHubFetch } from "./github/conversion";
import { MESSAGE_TEXTS } from "./i18n/messages";
import { escapeTelegramHtml } from "./message";
import type { OutboxMessage } from "./message";
import type { Language } from "./setup/language";
import { readNotifiedRelease, recordReleaseNotice } from "./store/notified-release";
import { readNotificationSettings } from "./store/settings";
import { compareVersions, parseVersion, versionText } from "./version";
import type { Version } from "./version";

export type ReleaseCheckResult =
  | "reported"
  | "off"
  | "invalid-version"
  | "no-release"
  | "refused"
  | "unavailable"
  | "malformed"
  | "current"
  | "known"
  | "store-failed";

export interface ReleaseCheckDeps extends DeliveryDeps {
  readonly githubFetch: GitHubFetch;
  readonly version: string;
}

/** The release notice in `language`: its Telegram HTML text and the button URL of the release. */
export function formatReleaseMessage(latest: Version, running: Version, language: Language): OutboxMessage {
  const texts = MESSAGE_TEXTS[language];
  const latestText = versionText(latest);
  const title = `<b>${escapeTelegramHtml(texts.newSelunaRelease)}</b> · ${escapeTelegramHtml(UPSTREAM_REPOSITORY)}`;
  const line = escapeTelegramHtml(texts.releaseAvailable(latestText, versionText(running)));
  // The URL is built from the three numbers, never from the tag text of the answer.
  return {
    text: `${title}\n${line}`,
    buttonUrl: `https://github.com/${UPSTREAM_REPOSITORY}/releases/tag/v${latestText}`,
  };
}

/** Reports the latest release once when it is newer than the running and the remembered version. Never rejects. */
export async function checkForRelease(startedAt: Date, deps: ReleaseCheckDeps): Promise<ReleaseCheckResult> {
  try {
    return await run(startedAt, deps);
  } catch {
    // The error is dropped: only the fixed result reaches the log.
    return "store-failed";
  }
}

async function run(startedAt: Date, deps: ReleaseCheckDeps): Promise<ReleaseCheckResult> {
  const settings = await readNotificationSettings(deps.db);
  if (!settings.updateNotice) {
    return "off";
  }
  const running = parseVersion(deps.version);
  if (running === undefined) {
    return "invalid-version";
  }
  const stored = await readNotifiedRelease(deps.db);
  const latest = await fetchLatestRelease(deps.githubFetch, deps.version);
  switch (latest.kind) {
    case "none":
      return "no-release";
    case "refused":
      return "refused";
    case "unavailable":
      return "unavailable";
    case "malformed":
      return "malformed";
    case "found":
      break;
  }
  if (compareVersions(latest.version, running) <= 0) {
    return "current";
  }
  const remembered = stored === undefined ? undefined : parseVersion(stored);
  if (remembered !== undefined && compareVersions(latest.version, remembered) <= 0) {
    return "known";
  }
  const message = formatReleaseMessage(latest.version, running, settings.language);
  const id = await recordReleaseNotice(
    deps.db,
    { text: message.text, buttonUrl: message.buttonUrl, silent: false },
    startedAt,
    versionText(latest.version),
    stored,
  );
  if (id === undefined) {
    return "known";
  }
  await deliverMessages([{ id, text: message.text, buttonUrl: message.buttonUrl, silent: false }], settings, deps);
  return "reported";
}
