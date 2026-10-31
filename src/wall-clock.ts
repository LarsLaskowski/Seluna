/* eslint-disable @typescript-eslint/no-unused-vars -- skeleton: the bodies arrive with the implementation */

/** A local date and time of day in a time zone. */
export interface WallClock {
  /** The local date as `YYYY-MM-DD`. */
  readonly date: string;
  /** The minutes since local midnight, 0 up to 1,439. */
  readonly minuteOfDay: number;
}

/**
 * A function giving the local date and minute of day of an instant in `timeZone`; it builds one
 * `Intl.DateTimeFormat`, reads an unusable zone as UTC and gives `undefined` for an instant it cannot convert.
 */
export function wallClockReader(timeZone: string): (at: Date) => WallClock | undefined {
  throw new Error("not implemented");
}
