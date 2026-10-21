import type { DeliveryDeps } from "./delivery";
import type { GitHubFetch } from "./github/conversion";
import type { OutboxMessage } from "./message";
import type { Language } from "./setup/language";
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
  throw new Error("Not implemented");
}

/** Reports the latest release once when it is newer than the running and the remembered version. Never rejects. */
export function checkForRelease(startedAt: Date, deps: ReleaseCheckDeps): Promise<ReleaseCheckResult> {
  return Promise.reject(new Error("Not implemented"));
}
