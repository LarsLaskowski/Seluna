import { describe, expect, it } from "vitest";
import { isQuietTime } from "./quiet-hours";

const MINUTE = 60_000;

interface Case {
  readonly start: string;
  readonly end: string;
  readonly instant: string;
  readonly expected: boolean;
}

interface ZoneCase extends Case {
  readonly wallClock: string;
}

const UTC_CASES: readonly Case[] = [
  { start: "22:00", end: "07:00", instant: "2026-10-17T21:59:59.999Z", expected: false },
  { start: "22:00", end: "07:00", instant: "2026-10-17T22:00:00.000Z", expected: true },
  { start: "22:00", end: "07:00", instant: "2026-10-17T23:30:00.000Z", expected: true },
  { start: "22:00", end: "07:00", instant: "2026-10-18T00:00:00.000Z", expected: true },
  { start: "22:00", end: "07:00", instant: "2026-10-18T06:59:59.999Z", expected: true },
  { start: "22:00", end: "07:00", instant: "2026-10-18T07:00:00.000Z", expected: false },
  { start: "22:00", end: "07:00", instant: "2026-10-18T12:00:00.000Z", expected: false },
  { start: "09:00", end: "17:00", instant: "2026-10-17T08:59:59.999Z", expected: false },
  { start: "09:00", end: "17:00", instant: "2026-10-17T09:00:00.000Z", expected: true },
  { start: "09:00", end: "17:00", instant: "2026-10-17T16:59:59.999Z", expected: true },
  { start: "09:00", end: "17:00", instant: "2026-10-17T17:00:00.000Z", expected: false },
  { start: "09:00", end: "17:00", instant: "2026-10-17T03:00:00.000Z", expected: false },
  { start: "00:00", end: "06:00", instant: "2026-10-17T23:59:59.999Z", expected: false },
  { start: "00:00", end: "06:00", instant: "2026-10-18T00:00:00.000Z", expected: true },
  { start: "00:00", end: "06:00", instant: "2026-10-18T05:59:59.999Z", expected: true },
  { start: "00:00", end: "06:00", instant: "2026-10-18T06:00:00.000Z", expected: false },
  { start: "22:00", end: "00:00", instant: "2026-10-17T21:59:59.999Z", expected: false },
  { start: "22:00", end: "00:00", instant: "2026-10-17T22:00:00.000Z", expected: true },
  { start: "22:00", end: "00:00", instant: "2026-10-17T23:59:59.999Z", expected: true },
  { start: "22:00", end: "00:00", instant: "2026-10-18T00:00:00.000Z", expected: false },
];

const BERLIN_CASES: readonly ZoneCase[] = [
  { start: "22:00", end: "07:00", instant: "2026-01-15T20:59:00Z", wallClock: "21:59 CET", expected: false },
  { start: "22:00", end: "07:00", instant: "2026-01-15T21:00:00Z", wallClock: "22:00 CET", expected: true },
  { start: "22:00", end: "07:00", instant: "2026-07-15T19:59:00Z", wallClock: "21:59 CEST", expected: false },
  { start: "22:00", end: "07:00", instant: "2026-07-15T20:00:00Z", wallClock: "22:00 CEST", expected: true },
  { start: "22:00", end: "07:00", instant: "2026-03-28T20:59:00Z", wallClock: "21:59 CET", expected: false },
  { start: "22:00", end: "07:00", instant: "2026-03-28T21:00:00Z", wallClock: "22:00 CET", expected: true },
  { start: "22:00", end: "07:00", instant: "2026-03-29T04:59:00Z", wallClock: "06:59 CEST", expected: true },
  { start: "22:00", end: "07:00", instant: "2026-03-29T05:00:00Z", wallClock: "07:00 CEST", expected: false },
  { start: "22:00", end: "07:00", instant: "2026-03-29T05:30:00Z", wallClock: "07:30 CEST", expected: false },
  { start: "01:00", end: "03:00", instant: "2026-03-29T00:00:00Z", wallClock: "01:00 CET", expected: true },
  { start: "01:00", end: "03:00", instant: "2026-03-29T00:59:00Z", wallClock: "01:59 CET", expected: true },
  { start: "01:00", end: "03:00", instant: "2026-03-29T01:00:00Z", wallClock: "03:00 CEST", expected: false },
  { start: "02:00", end: "03:00", instant: "2026-03-29T00:59:00Z", wallClock: "01:59 CET", expected: false },
  { start: "02:00", end: "03:00", instant: "2026-03-29T01:00:00Z", wallClock: "03:00 CEST", expected: false },
  { start: "22:00", end: "07:00", instant: "2026-10-24T19:59:00Z", wallClock: "21:59 CEST", expected: false },
  { start: "22:00", end: "07:00", instant: "2026-10-24T20:00:00Z", wallClock: "22:00 CEST", expected: true },
  { start: "22:00", end: "07:00", instant: "2026-10-25T05:30:00Z", wallClock: "06:30 CET", expected: true },
  { start: "22:00", end: "07:00", instant: "2026-10-25T05:59:00Z", wallClock: "06:59 CET", expected: true },
  { start: "22:00", end: "07:00", instant: "2026-10-25T06:00:00Z", wallClock: "07:00 CET", expected: false },
  { start: "02:00", end: "03:00", instant: "2026-10-24T23:59:00Z", wallClock: "01:59 CEST", expected: false },
  { start: "02:00", end: "03:00", instant: "2026-10-25T00:00:00Z", wallClock: "02:00 CEST", expected: true },
  { start: "02:00", end: "03:00", instant: "2026-10-25T00:59:00Z", wallClock: "02:59 CEST", expected: true },
  { start: "02:00", end: "03:00", instant: "2026-10-25T01:00:00Z", wallClock: "02:00 CET", expected: true },
  { start: "02:00", end: "03:00", instant: "2026-10-25T01:59:00Z", wallClock: "02:59 CET", expected: true },
  { start: "02:00", end: "03:00", instant: "2026-10-25T02:00:00Z", wallClock: "03:00 CET", expected: false },
];

describe("isQuietTime", () => {
  it("isQuietTime is never quiet when quiet hours are off", () => {
    const first = Date.parse("2026-10-24T22:00:00Z");
    const last = Date.parse("2026-10-25T23:59:00Z");
    const minutes = Array.from({ length: (last - first) / MINUTE + 1 }, (_, index) => new Date(first + index * MINUTE));

    const quietMinutes = minutes.filter((at) => isQuietTime(undefined, "Europe/Berlin", at));

    expect(minutes.length, "minutes of the 25-hour day checked").toBe(1560);
    expect(quietMinutes.length, "quiet minutes").toBe(0);
    expect(isQuietTime(undefined, "UTC", new Date("2026-10-17T03:00:00Z")), "UTC at 03:00").toBe(false);
  });

  it.each(UTC_CASES)(
    "isQuietTime is $expected at $instant for quiet hours $start–$end in UTC",
    ({ start, end, instant, expected }) => {
      const result = isQuietTime({ start, end }, "UTC", new Date(instant));

      expect(result, "quiet").toBe(expected);
    },
  );

  it.each(BERLIN_CASES)(
    "isQuietTime is $expected at $instant ($wallClock) for quiet hours $start–$end in Europe/Berlin",
    ({ start, end, instant, expected }) => {
      const result = isQuietTime({ start, end }, "Europe/Berlin", new Date(instant));

      expect(result, "quiet").toBe(expected);
    },
  );

  it("isQuietTime reads a zone the runtime rejects as UTC", () => {
    const quiet = { start: "22:00", end: "07:00" };

    const atStart = isQuietTime(quiet, "Not/AZone", new Date("2026-10-17T22:00:00Z"));
    const beforeStart = isQuietTime(quiet, "Not/AZone", new Date("2026-10-17T21:59:00Z"));

    expect(atStart, "at the start in UTC").toBe(true);
    expect(beforeStart, "before the start in UTC").toBe(false);
  });

  it("isQuietTime is not quiet for an invalid time", () => {
    const result = isQuietTime({ start: "00:00", end: "23:59" }, "UTC", new Date(Number.NaN));

    expect(result, "quiet").toBe(false);
  });

  it.each([
    { start: "7:00", end: "22:00", instant: "2026-10-17T12:00:00Z" },
    { start: "24:00", end: "07:00", instant: "2026-10-17T00:30:00Z" },
    { start: "22:00", end: "07:00x", instant: "2026-10-17T23:00:00Z" },
  ])("isQuietTime is not quiet for malformed quiet hours $start–$end", ({ start, end, instant }) => {
    const result = isQuietTime({ start, end }, "UTC", new Date(instant));

    expect(result, "quiet").toBe(false);
  });

  it("isQuietTime is not quiet when start equals end", () => {
    const result = isQuietTime({ start: "07:00", end: "07:00" }, "UTC", new Date("2026-10-17T07:00:00Z"));

    expect(result, "quiet").toBe(false);
  });
});
