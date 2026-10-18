import { isClockTime } from "./settings";
import type { QuietHours } from "./settings";

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;

function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * MINUTES_PER_HOUR + (minutes ?? 0);
}

function utcMinuteOfDay(at: Date): number {
  return at.getUTCHours() * MINUTES_PER_HOUR + at.getUTCMinutes();
}

function zonedMinuteOfDay(timeZone: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(at);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    return hour * MINUTES_PER_HOUR + minute;
  } catch {
    // A zone the runtime rejects (and an invalid date, which yields NaN here) is read as UTC.
    return utcMinuteOfDay(at);
  }
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
  const minute = zonedMinuteOfDay(timeZone, at);
  if (start === end || !Number.isInteger(minute) || minute < 0 || minute >= MINUTES_PER_DAY) {
    return false;
  }
  return start < end ? start <= minute && minute < end : minute >= start || minute < end;
}
