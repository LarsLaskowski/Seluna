import type { OwnerAccount } from "../github/owner";

/** The payload's `sender` as a record, or `undefined` when it has none. */
function senderOf(payload: unknown): Record<string, unknown> | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  const { sender } = payload as Record<string, unknown>; // narrowed to an object above
  if (typeof sender !== "object" || sender === null || Array.isArray(sender)) {
    return undefined;
  }
  return sender as Record<string, unknown>; // narrowed to an object above
}

/** Whether the payload's `sender` is the app owner (a User account only), compared by account id (a renamed login still matches). */
export function isOwnAction(payload: unknown, owner: OwnerAccount | undefined): boolean {
  if (owner?.type !== "User") {
    return false;
  }
  const id = senderOf(payload)?.id;
  return typeof id === "number" && id === owner.id;
}

/** Whether the payload's `sender.type` is exactly `Bot`. */
export function isBotSender(payload: unknown): boolean {
  return senderOf(payload)?.type === "Bot";
}
