/* eslint-disable @typescript-eslint/no-unused-vars -- skeleton: the bodies arrive with the implementation */
import type { OwnerAccount } from "../github/owner";
import type { NotificationSettings } from "../settings";
import type { Rule, StarRemoval, WebhookPayload } from "./rule";

/** Reports a repository starred by another account (event `star`, action `created`). */
export const REPOSITORY_STARRED: Rule = {
  id: "repository_starred",
  evaluate: () => undefined,
};

/**
 * The removal of a star taken back by a foreign account (event `star`, action `deleted`, the rule's switch on);
 * otherwise `undefined`.
 */
export function starRemovalOf(
  event: string,
  payload: WebhookPayload,
  settings: NotificationSettings,
  owner: OwnerAccount | undefined,
): StarRemoval | undefined {
  throw new Error("not implemented");
}
