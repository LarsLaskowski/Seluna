import type { OwnerAccount } from "../github/owner";

/** Whether the payload's `sender` is the app owner, compared by account id (a renamed login still matches). */
export function isOwnAction(payload: unknown, owner: OwnerAccount | undefined): boolean {
  throw new Error("Not implemented");
}

/** Whether the payload's `sender.type` is exactly `Bot`. */
export function isBotSender(payload: unknown): boolean {
  throw new Error("Not implemented");
}
