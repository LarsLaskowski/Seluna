import type { OwnerAccount } from "../github/owner";
import type { BoundedEvent } from "../store/meta";
import type { WebhookPayload } from "./rule";
import { isOwnAction, isOwnerAccount } from "./actor";
import { recordField, stringField } from "./pull-request";

/** Author associations of a pull request that are never counted against the bound. */
export const ADMITTED_AUTHOR_ASSOCIATIONS: ReadonlySet<string> = new Set<string>(["OWNER", "MEMBER", "COLLABORATOR"]);

/** Events of a workflow run that are never counted against the bound: only an account the owner admitted causes them. */
export const ADMITTED_ONLY_RUN_EVENTS: ReadonlySet<string> = new Set<string>([
  "push",
  "schedule",
  "merge_group",
  "release",
  "create",
  "delete",
  "page_build",
  "label",
  "milestone",
  "registry_package",
  "branch_protection_rule",
]);

/**
 * Whether the pull request of the payload comes from a stranger: not the owner and without an admitted author
 * association. A missing or mistyped value counts as a stranger.
 */
export function isStrangerPullRequest(payload: WebhookPayload, owner: OwnerAccount | undefined): boolean {
  if (isOwnAction(payload, owner)) {
    return false;
  }
  const association = stringField(recordField(payload, "pull_request") ?? {}, "author_association");
  return association === undefined || !ADMITTED_AUTHOR_ASSOCIATIONS.has(association);
}

/** Whether the workflow run of the payload was triggered by a stranger: not the owner and not an admitted-only event. */
export function isStrangerRun(payload: WebhookPayload, owner: OwnerAccount | undefined): boolean {
  const run = recordField(payload, "workflow_run") ?? {};
  if (isOwnerAccount(recordField(run, "triggering_actor"), owner)) {
    return false;
  }
  const event = stringField(run, "event");
  return event === undefined || !ADMITTED_ONLY_RUN_EVENTS.has(event);
}

/** Whether a delivery of `event` counts against the hourly bound. */
export function isCountedDelivery(
  event: BoundedEvent,
  payload: WebhookPayload,
  owner: OwnerAccount | undefined,
): boolean {
  switch (event) {
    case "issues":
    case "issue_comment":
    case "star":
    case "fork":
      return true;
    case "pull_request":
      return isStrangerPullRequest(payload, owner);
    case "workflow_run":
      return isStrangerRun(payload, owner);
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
