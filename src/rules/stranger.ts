import type { OwnerAccount } from "../github/owner";
import type { BoundedEvent } from "../store/meta";
import type { WebhookPayload } from "./rule";

/** Author associations of a pull request that are never counted against the bound. */
export const ADMITTED_AUTHOR_ASSOCIATIONS: ReadonlySet<string> = new Set<string>();

/** Events of a workflow run that are never counted against the bound. */
export const ADMITTED_ONLY_RUN_EVENTS: ReadonlySet<string> = new Set<string>();

/**
 * Whether the pull request of the payload comes from a stranger: not the owner and without an admitted author
 * association.
 */
export function isStrangerPullRequest(_payload: WebhookPayload, _owner: OwnerAccount | undefined): boolean {
  throw new Error("Not implemented");
}

/** Whether the workflow run of the payload was triggered by a stranger: not the owner and not an admitted-only event. */
export function isStrangerRun(_payload: WebhookPayload, _owner: OwnerAccount | undefined): boolean {
  throw new Error("Not implemented");
}

/** Whether a delivery of `event` counts against the hourly bound. */
export function isCountedDelivery(
  _event: BoundedEvent,
  _payload: WebhookPayload,
  _owner: OwnerAccount | undefined,
): boolean {
  throw new Error("Not implemented");
}
