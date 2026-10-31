import type { ActivityDigest } from "./settings";
import { wallClockReader } from "./wall-clock";
import type { WallClock } from "./wall-clock";

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;
/** A gap longer than this holds a full hour in any time zone, so an hourly digest is due without a conversion. */
const HOURLY_SHORTCUT_MINUTES = 120;
/** A gap longer than this holds a whole local day in any time zone, so a daily digest is due without a conversion. */
const DAILY_SHORTCUT_MINUTES = 1500;
const MS_PER_DAY = 86_400_000;
/** How far from a local time the offset is sampled to see a clock change next to it. */
const TRANSITION_REACH_MINUTES = 180;

type Reader = (at: Date) => WallClock | undefined;

/** The day number (days since 1970-01-01) of a `YYYY-MM-DD` date. */
function dayNumberOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Math.round(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / MS_PER_DAY);
}

/** The date text of a day number. */
function dateOfDayNumber(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** The offset of the local clock from UTC in minutes at the instant of `minute` (minutes since the epoch). */
function offsetAt(read: Reader, minute: number): number | undefined {
  const clock = read(new Date(minute * MS_PER_MINUTE));
  return clock === undefined ? undefined : dayNumberOf(clock.date) * MINUTES_PER_DAY + clock.minuteOfDay - minute;
}

function distinct(values: readonly (number | undefined)[]): number[] {
  return [...new Set(values.filter((value): value is number => value !== undefined))];
}

/** Whether an instant with local minute 00 lies in the minutes `after` (exclusive) up to `upTo` (inclusive). */
function hourlyDue(read: Reader, previousRun: Date, now: Date): boolean {
  const first = Math.floor(previousRun.getTime() / MS_PER_MINUTE) + 1;
  const last = Math.floor(now.getTime() / MS_PER_MINUTE);
  const offsets = distinct([offsetAt(read, first - 1), offsetAt(read, last)]);
  for (let minute = first; minute <= last; minute += 1) {
    const matches = offsets.some((offset) => (((minute + offset) % MINUTES_PER_HOUR) + MINUTES_PER_HOUR) % 60 === 0);
    if (matches && (read(new Date(minute * MS_PER_MINUTE))?.minuteOfDay ?? 1) % MINUTES_PER_HOUR === 0) {
      return true;
    }
  }
  return false;
}

/** Whether the local clock at `minute` is at or after `time` on `date`. */
function reached(read: Reader, minute: number, date: string, time: number): WallClock | undefined {
  const clock = read(new Date(minute * MS_PER_MINUTE));
  if (clock === undefined) {
    return undefined;
  }
  return clock.date > date || (clock.date === date && clock.minuteOfDay >= time) ? clock : undefined;
}

/** The first minute of local `date` at or after `time`, searched between `low` and `high`; `undefined` when none. */
function dailyInstant(read: Reader, date: string, time: number, low: number, high: number): number | undefined {
  let found = low;
  if (reached(read, low, date, time) === undefined) {
    if (reached(read, high, date, time) === undefined) {
      return undefined;
    }
    let below = low;
    let above = high;
    while (above - below > 1) {
      const middle = below + Math.floor((above - below) / 2);
      if (reached(read, middle, date, time) === undefined) {
        below = middle;
      } else {
        above = middle;
      }
    }
    found = above;
  }
  return reached(read, found, date, time)?.date === date ? found : undefined;
}

/** Whether the first instant of a local date at or after `time` lies in the minutes after `previousRun` up to `now`. */
function dailyDue(read: Reader, time: string, previousRun: Date, now: Date): boolean {
  const [hours, minutes] = time.split(":").map(Number);
  const target = (hours ?? 0) * MINUTES_PER_HOUR + (minutes ?? 0);
  const previousMinute = Math.floor(previousRun.getTime() / MS_PER_MINUTE);
  const nowMinute = Math.floor(now.getTime() / MS_PER_MINUTE);
  const previousClock = read(previousRun);
  const nowClock = read(now);
  const offsets = distinct([offsetAt(read, previousMinute), offsetAt(read, nowMinute)]);
  if (previousClock === undefined || nowClock === undefined || offsets.length === 0) {
    return false;
  }
  for (let day = dayNumberOf(previousClock.date); day <= dayNumberOf(nowClock.date); day += 1) {
    const base = day * MINUTES_PER_DAY + target;
    // A clock change near the target may lie outside the interval; its other offset shows a few hours around it.
    const around = base - (offsets[0] ?? 0);
    const dayOffsets = distinct([
      ...offsets,
      offsetAt(read, around - TRANSITION_REACH_MINUTES),
      offsetAt(read, around + TRANSITION_REACH_MINUTES),
    ]);
    const instant = dailyInstant(
      read,
      dateOfDayNumber(day),
      target,
      base - Math.max(...dayOffsets),
      base - Math.min(...dayOffsets),
    );
    if (
      instant !== undefined &&
      instant * MS_PER_MINUTE > previousRun.getTime() &&
      instant * MS_PER_MINUTE <= now.getTime()
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a digest is due in the interval after `previousRun` up to and including `now`: `immediate` always,
 * `hourly` when an instant with local minute 00 lies in it, `daily` when the first instant of a local date at or
 * after the digest time does. `now` at or before `previousRun` is never due.
 */
export function isDigestDue(digest: ActivityDigest, timeZone: string, previousRun: Date, now: Date): boolean {
  if (digest.kind === "immediate") {
    return true;
  }
  const gapMinutes = (now.getTime() - previousRun.getTime()) / MS_PER_MINUTE;
  if (Number.isNaN(gapMinutes) || gapMinutes <= 0) {
    return false;
  }
  if (gapMinutes > (digest.kind === "hourly" ? HOURLY_SHORTCUT_MINUTES : DAILY_SHORTCUT_MINUTES)) {
    return true;
  }
  const read = wallClockReader(timeZone);
  return digest.kind === "hourly" ? hourlyDue(read, previousRun, now) : dailyDue(read, digest.time, previousRun, now);
}
