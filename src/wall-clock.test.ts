import { describe, expect, it } from "vitest";
import { wallClockReader } from "./wall-clock";
import { countIntl } from "../test/activity";

describe("wallClockReader", () => {
  it.each([
    { case: "UTC", zone: "UTC", at: "2026-10-25T00:30:00Z", date: "2026-10-25", minute: 30 },
    { case: "the epoch in UTC", zone: "UTC", at: "1970-01-01T00:00:00Z", date: "1970-01-01", minute: 0 },
    {
      case: "Europe/Berlin in winter",
      zone: "Europe/Berlin",
      at: "2026-01-15T17:05:00Z",
      date: "2026-01-15",
      minute: 1085,
    },
    {
      case: "Europe/Berlin in summer",
      zone: "Europe/Berlin",
      at: "2026-07-15T16:05:00Z",
      date: "2026-07-15",
      minute: 1085,
    },
    {
      case: "Europe/Berlin across local midnight",
      zone: "Europe/Berlin",
      at: "2026-01-15T23:30:00Z",
      date: "2026-01-16",
      minute: 30,
    },
    {
      case: "exactly local midnight, which is minute 0 and not 1440",
      zone: "Europe/Berlin",
      at: "2026-01-15T23:00:00Z",
      date: "2026-01-16",
      minute: 0,
    },
    {
      case: "Asia/Kolkata with its half hour offset",
      zone: "Asia/Kolkata",
      at: "2026-01-01T18:30:00Z",
      date: "2026-01-02",
      minute: 0,
    },
    {
      case: "Asia/Kathmandu with its 45 minute offset",
      zone: "Asia/Kathmandu",
      at: "2026-01-01T12:15:00Z",
      date: "2026-01-01",
      minute: 1080,
    },
    {
      case: "America/New_York before midnight UTC",
      zone: "America/New_York",
      at: "2026-01-15T03:59:00Z",
      date: "2026-01-14",
      minute: 1379,
    },
    { case: "the seconds are ignored", zone: "UTC", at: "2026-10-25T12:34:59Z", date: "2026-10-25", minute: 754 },
  ])("wallClockReader reads $case", ({ zone, at, date, minute }) => {
    const clock = wallClockReader(zone)(new Date(at));

    expect(clock, "wall clock").toEqual({ date, minuteOfDay: minute });
  });

  it.each([
    { case: "the first 02:30 of the fall-back day", at: "2026-10-25T00:30:00Z", minute: 150 },
    { case: "the repeated 02:30 of the fall-back day", at: "2026-10-25T01:30:00Z", minute: 150 },
    { case: "01:59 before the spring change", at: "2026-03-29T00:59:00Z", minute: 119 },
    { case: "03:00 right after the spring change", at: "2026-03-29T01:00:00Z", minute: 180 },
  ])("wallClockReader reads Europe/Berlin $case", ({ at, minute }) => {
    const clock = wallClockReader("Europe/Berlin")(new Date(at));

    expect(clock, "wall clock").toEqual({ date: at.slice(0, 10), minuteOfDay: minute });
  });

  it.each([{ zone: "Mars/Base" }, { zone: "" }, { zone: "+01:00" }])(
    "wallClockReader reads the unusable zone '$zone' as UTC",
    ({ zone }) => {
      const clock = wallClockReader(zone)(new Date("2026-06-01T10:20:00Z"));

      expect(clock, "wall clock").toEqual({ date: "2026-06-01", minuteOfDay: 620 });
    },
  );

  it("wallClockReader gives undefined for an invalid date", () => {
    const clock = wallClockReader("Europe/Berlin")(new Date(Number.NaN));

    expect(clock, "wall clock").toBeUndefined();
  });

  it("wallClockReader builds one formatter for the reader, not one per call", () => {
    const counts = countIntl();
    try {
      const read = wallClockReader("Europe/Berlin");
      read(new Date("2026-01-01T00:00:00Z"));
      read(new Date("2026-01-01T00:10:00Z"));
      read(new Date("2026-01-01T00:20:00Z"));

      expect(counts.formatters(), "formatters built").toBe(1);
    } finally {
      counts.restore();
    }
  });
});
