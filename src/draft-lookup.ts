import type { DraftResult, PullRequestRef } from "./github/api-client";
import type { Notification } from "./rules/rule";

/** The longest a draft lookup may take before it counts as failed; GitHub waits 10 s for the answer. */
export const DRAFT_LOOKUP_TIMEOUT_MS = 8_000;

const FAILED: DraftResult = { kind: "failed" };

/** Asks whether a pull request is a draft, as the installation. Never rejects. */
export type DraftLookup = (installationId: number, pullRequest: PullRequestRef) => Promise<DraftResult>;

/** `lookup` cut off after `timeoutMs` (measured by `sleep`): a later or rejected answer is `failed`. */
export function boundedDraftLookup(
  lookup: DraftLookup,
  timeoutMs: number,
  sleep: (milliseconds: number) => Promise<void>,
): DraftLookup {
  return async (installationId, pullRequest) => {
    const timeout = sleep(timeoutMs).then((): DraftResult => FAILED);
    const answer = (async (): Promise<DraftResult> => {
      try {
        return await lookup(installationId, pullRequest);
      } catch {
        return FAILED;
      }
    })();
    return Promise.race([answer, timeout]);
  };
}

/**
 * The notifications after their draft checks: drafts dropped, unknown states titled `titleWhenUnknown`, or dropped without one.
 * The checks run concurrently and keep the order of `notifications`; each lookup is bounded by
 * `boundedDraftLookup`, so the total stays within one lookup's budget however many checks there are.
 */
export async function applyDraftChecks(
  notifications: readonly Notification[],
  installationId: number | undefined,
  lookup: DraftLookup,
): Promise<readonly Notification[]> {
  const resolved = await Promise.all(
    notifications.map(async (notification): Promise<Notification | undefined> => {
      const check = notification.draftCheck;
      if (check === undefined) {
        return notification;
      }
      const result = installationId === undefined ? FAILED : await lookup(installationId, check.pullRequest);
      if (result.kind === "failed") {
        return check.titleWhenUnknown === undefined ? undefined : { ...notification, title: check.titleWhenUnknown };
      }
      return result.draft ? undefined : notification;
    }),
  );
  return resolved.filter((notification): notification is Notification => notification !== undefined);
}
