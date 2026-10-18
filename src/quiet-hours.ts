import type { QuietHours } from "./settings";

/**
 * Whether `at` lies in `quietHours` on the wall clock of `timeZone`, by the minute: the start minute is quiet, the
 * end minute is not, and a start later than the end spans midnight. Off (`undefined`), malformed or equal times and
 * an invalid `at` are never quiet; a zone `Intl.DateTimeFormat` rejects is read as UTC. Reads no clock; never throws.
 */
export function isQuietTime(quietHours: QuietHours | undefined, timeZone: string, at: Date): boolean {
  void quietHours;
  void timeZone;
  void at;
  throw new Error("Not implemented");
}
