import { isClockTime } from "./settings";
import { wallClockReader } from "./wall-clock";
import type { QuietHours } from "./settings";

const MINUTES_PER_HOUR = 60;

function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * MINUTES_PER_HOUR + (minutes ?? 0);
}

/**
 * Whether `at` lies in `quietHours` on the wall clock of `timeZone`, by the minute: the start minute is quiet, the
 * end minute is not, and a start later than the end spans midnight. Off (`undefined`), malformed or equal times and
 * an invalid `at` are never quiet; a zone `Intl.DateTimeFormat` rejects is read as UTC. Reads no clock; never throws.
 */
export function isQuietTime(quietHours: QuietHours | undefined, timeZone: string, at: Date): boolean {
  if (quietHours === undefined || !isClockTime(quietHours.start) || !isClockTime(quietHours.end)) {
    return false;
  }
  const start = minutesOfDay(quietHours.start);
  const end = minutesOfDay(quietHours.end);
  const minute = wallClockReader(timeZone)(at)?.minuteOfDay;
  if (start === end || minute === undefined) {
    return false;
  }
  return start < end ? start <= minute && minute < end : minute >= start || minute < end;
}
