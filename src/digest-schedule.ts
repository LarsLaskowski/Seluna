/* eslint-disable @typescript-eslint/no-unused-vars -- skeleton: the bodies arrive with the implementation */
import type { ActivityDigest } from "./settings";

/**
 * Whether a digest is due in the interval after `previousRun` up to and including `now`: `immediate` always,
 * `hourly` when an instant with local minute 00 lies in it, `daily` when the first instant of a local date at or
 * after the digest time does. `now` at or before `previousRun` is never due.
 */
export function isDigestDue(digest: ActivityDigest, timeZone: string, previousRun: Date, now: Date): boolean {
  throw new Error("not implemented");
}
