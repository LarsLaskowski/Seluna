/* eslint-disable @typescript-eslint/no-unused-vars -- skeleton: the bodies arrive with the implementation */
import type { DeliveryDeps } from "./delivery";

/** What a digest run did. `store-failed` stores no run time, so the next run evaluates again. */
export type DigestJobResult = "sent" | "queued" | "nothing-due" | "empty" | "off" | "store-failed";

/**
 * Builds and commits the activity digest when it is due. With `sendNow` the digest row is sent in this run,
 * otherwise it stays pending for the next retry. Never rejects.
 */
export function runActivityDigest(startedAt: Date, deps: DeliveryDeps, sendNow: boolean): Promise<DigestJobResult> {
  return Promise.reject(new Error("not implemented"));
}
