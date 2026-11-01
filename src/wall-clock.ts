/** A local date and time of day in a time zone. */
export interface WallClock {
  /** The local date as `YYYY-MM-DD`. */
  readonly date: string;
  /** The minutes since local midnight, 0 up to 1,439. */
  readonly minuteOfDay: number;
}

const MINUTES_PER_HOUR = 60;
const FALLBACK_ZONE = "UTC";
/** A resolved time zone in this form (`+01:00`, `-05:00`) is a fixed offset, not a zone name. */
export const OFFSET_FORM = /^[+-]/;

function formatterOf(timeZone: string): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  };
  try {
    // A fixed offset such as `+01:00` is no time zone name of the settings, though the runtime accepts it.
    if (OFFSET_FORM.test(timeZone)) {
      throw new RangeError("Not a time zone name");
    }
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone });
  } catch {
    // A zone the runtime rejects is read as UTC.
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: FALLBACK_ZONE });
  }
}

/**
 * A function giving the local date and minute of day of an instant in `timeZone`; it builds one
 * `Intl.DateTimeFormat`, reads an unusable zone as UTC and gives `undefined` for an instant it cannot convert.
 */
export function wallClockReader(timeZone: string): (at: Date) => WallClock | undefined {
  const formatter = formatterOf(timeZone);
  return (at) => {
    let parts: Intl.DateTimeFormatPart[];
    try {
      parts = formatter.formatToParts(at);
    } catch {
      // An invalid date cannot be converted.
      return undefined;
    }
    const value = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
      parts.find((part) => part.type === type)?.value;
    const year = value("year");
    const month = value("month");
    const day = value("day");
    const hour = Number(value("hour")) % 24;
    const minute = Number(value("minute"));
    if (year === undefined || month === undefined || day === undefined || !Number.isInteger(hour + minute)) {
      return undefined;
    }
    return { date: `${year}-${month}-${day}`, minuteOfDay: hour * MINUTES_PER_HOUR + minute };
  };
}
