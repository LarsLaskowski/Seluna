import type { DraftResult, PullRequestRef } from "./github/api-client";
import type { Notification } from "./rules/rule";

/** The longest a draft lookup may take before it counts as failed; GitHub waits 10 s for the answer. */
export const DRAFT_LOOKUP_TIMEOUT_MS = 8_000;

/** Asks whether a pull request is a draft, as the installation. Never rejects. */
export type DraftLookup = (installationId: number, pullRequest: PullRequestRef) => Promise<DraftResult>;

/** `lookup` cut off after `timeoutMs` (measured by `sleep`): a later or rejected answer is `failed`. */
export function boundedDraftLookup(
  lookup: DraftLookup,
  timeoutMs: number,
  sleep: (milliseconds: number) => Promise<void>,
): DraftLookup {
  void lookup;
  void timeoutMs;
  void sleep;
  throw new Error("Not implemented");
}

/**
 * The notifications after their draft checks: drafts dropped, unknown states titled `titleWhenUnknown`.
 * Checks run one after another, so the 8-second budget assumes only one rule sets a `draftCheck`.
 */
export function applyDraftChecks(
  notifications: readonly Notification[],
  installationId: number | undefined,
  lookup: DraftLookup,
): Promise<readonly Notification[]> {
  void notifications;
  void installationId;
  void lookup;
  throw new Error("Not implemented");
}
