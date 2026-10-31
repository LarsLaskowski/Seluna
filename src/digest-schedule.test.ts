import { describe, expect, it } from "vitest";
import { isDigestDue } from "./digest-schedule";
import type { ActivityDigest } from "./settings";
import { countIntl } from "../test/activity";

const MINUTE_MS = 60_000;
const HOURLY: ActivityDigest = { kind: "hourly" };
const IMMEDIATE: ActivityDigest = { kind: "immediate" };

function daily(time: string): ActivityDigest {
  return { kind: "daily", time };
}

function due(digest: ActivityDigest, timeZone: string, previous: string, now: string): boolean {
  return isDigestDue(digest, timeZone, new Date(previous), new Date(now));
}

/** How many of the runs every ten minutes after `from`, up to and including `to`, find a digest due. */
function dueRuns(digest: ActivityDigest, timeZone: string, from: string, to: string): number {
  let count = 0;
  for (let run = Date.parse(from); run < Date.parse(to); run += 10 * MINUTE_MS) {
    if (isDigestDue(digest, timeZone, new Date(run), new Date(run + 10 * MINUTE_MS))) {
      count += 1;
    }
  }
  return count;
}

describe("isDigestDue", () => {
  it.each([
    {
      case: "the run reaches the full hour",
      previous: "2026-10-21T12:50:00Z",
      now: "2026-10-21T13:00:00Z",
      expected: true,
    },
    {
      case: "the run is just before the full hour",
      previous: "2026-10-21T12:50:00Z",
      now: "2026-10-21T12:59:00Z",
      expected: false,
    },
    {
      case: "the run is just after the full hour",
      previous: "2026-10-21T12:50:00Z",
      now: "2026-10-21T13:00:30Z",
      expected: true,
    },
    {
      case: "the previous run was at the full hour",
      previous: "2026-10-21T13:00:00Z",
      now: "2026-10-21T13:10:00Z",
      expected: false,
    },
    {
      case: "a late run catches up once",
      previous: "2026-10-21T12:50:00Z",
      now: "2026-10-21T14:20:00Z",
      expected: true,
    },
    {
      case: "the next run after the catch up",
      previous: "2026-10-21T14:20:00Z",
      now: "2026-10-21T14:30:00Z",
      expected: false,
    },
    { case: "a gap of days", previous: "2026-10-18T12:50:00Z", now: "2026-10-21T12:51:00Z", expected: true },
    {
      case: "now equal to the previous run",
      previous: "2026-10-21T13:00:00Z",
      now: "2026-10-21T13:00:00Z",
      expected: false,
    },
    {
      case: "now before the previous run",
      previous: "2026-10-21T14:00:00Z",
      now: "2026-10-21T13:00:00Z",
      expected: false,
    },
  ])("isDigestDue hourly in UTC: $case", ({ previous, now, expected }) => {
    expect(due(HOURLY, "UTC", previous, now), "due").toBe(expected);
  });

  it.each([
    {
      case: "Asia/Kolkata at local :00, which is :30 UTC",
      zone: "Asia/Kolkata",
      previous: "2026-10-21T12:20:00Z",
      now: "2026-10-21T12:30:00Z",
      expected: true,
    },
    {
      case: "Asia/Kolkata at :00 UTC, which is local :30",
      zone: "Asia/Kolkata",
      previous: "2026-10-21T11:50:00Z",
      now: "2026-10-21T12:00:00Z",
      expected: false,
    },
    {
      case: "Asia/Kathmandu at local :00, which is :15 UTC",
      zone: "Asia/Kathmandu",
      previous: "2026-10-21T12:10:00Z",
      now: "2026-10-21T12:15:00Z",
      expected: true,
    },
    {
      case: "Asia/Kathmandu just before it",
      zone: "Asia/Kathmandu",
      previous: "2026-10-21T12:00:00Z",
      now: "2026-10-21T12:14:00Z",
      expected: false,
    },
    {
      case: "Asia/Kathmandu at :00 UTC",
      zone: "Asia/Kathmandu",
      previous: "2026-10-21T11:50:00Z",
      now: "2026-10-21T12:00:00Z",
      expected: false,
    },
  ])("isDigestDue hourly in $case", ({ zone, previous, now, expected }) => {
    expect(due(HOURLY, zone, previous, now), "due").toBe(expected);
  });

  it.each([
    {
      case: "the run reaches 18:00 in winter (17:00 UTC)",
      previous: "2026-01-15T16:50:00Z",
      now: "2026-01-15T17:00:00Z",
      expected: true,
    },
    { case: "just before 18:00", previous: "2026-01-15T16:50:00Z", now: "2026-01-15T16:59:00Z", expected: false },
    {
      case: "the previous run was at 18:00",
      previous: "2026-01-15T17:00:00Z",
      now: "2026-01-15T17:10:00Z",
      expected: false,
    },
    {
      case: "a run on the next day before 18:00",
      previous: "2026-01-15T17:10:00Z",
      now: "2026-01-16T16:59:00Z",
      expected: false,
    },
    {
      case: "a run on the next day at 18:00",
      previous: "2026-01-15T17:10:00Z",
      now: "2026-01-16T17:00:00Z",
      expected: true,
    },
    {
      case: "a late run catches up once",
      previous: "2026-01-15T16:50:00Z",
      now: "2026-01-15T19:00:00Z",
      expected: true,
    },
    {
      case: "the next run after the catch up",
      previous: "2026-01-15T19:00:00Z",
      now: "2026-01-15T19:10:00Z",
      expected: false,
    },
    { case: "a gap of days", previous: "2026-01-10T12:00:00Z", now: "2026-01-15T12:00:00Z", expected: true },
    {
      case: "the run reaches 18:00 in summer (16:00 UTC)",
      previous: "2026-07-15T15:50:00Z",
      now: "2026-07-15T16:00:00Z",
      expected: true,
    },
    {
      case: "17:00 UTC in summer is not 18:00",
      previous: "2026-07-15T16:50:00Z",
      now: "2026-07-15T17:00:00Z",
      expected: false,
    },
  ])("isDigestDue daily at 18:00 in Europe/Berlin: $case", ({ previous, now, expected }) => {
    expect(due(daily("18:00"), "Europe/Berlin", previous, now), "due").toBe(expected);
  });

  it.each([
    {
      case: "daily at 00:00 in UTC reaches midnight",
      digest: daily("00:00"),
      zone: "UTC",
      previous: "2026-10-20T23:50:00Z",
      now: "2026-10-21T00:00:00Z",
      expected: true,
    },
    {
      case: "daily at 23:59 in UTC",
      digest: daily("23:59"),
      zone: "UTC",
      previous: "2026-10-21T23:50:00Z",
      now: "2026-10-21T23:59:00Z",
      expected: true,
    },
    {
      case: "daily at 05:30 in Asia/Kolkata (00:00 UTC)",
      digest: daily("05:30"),
      zone: "Asia/Kolkata",
      previous: "2026-10-20T23:50:00Z",
      now: "2026-10-21T00:00:00Z",
      expected: true,
    },
    {
      case: "daily at 06:00 in Asia/Kathmandu (00:15 UTC)",
      digest: daily("06:00"),
      zone: "Asia/Kathmandu",
      previous: "2026-10-21T00:10:00Z",
      now: "2026-10-21T00:15:00Z",
      expected: true,
    },
    {
      case: "immediate on any run",
      digest: IMMEDIATE,
      zone: "UTC",
      previous: "2026-10-21T13:00:00Z",
      now: "2026-10-21T13:10:00Z",
      expected: true,
    },
  ])("isDigestDue: $case", ({ digest, zone, previous, now, expected }) => {
    expect(due(digest, zone, previous, now), "due").toBe(expected);
  });

  it("isDigestDue reads an unusable time zone as UTC", () => {
    expect(due(daily("18:00"), "Mars/Base", "2026-01-15T17:50:00Z", "2026-01-15T18:00:00Z"), "at 18:00 UTC").toBe(true);
    expect(due(daily("18:00"), "Mars/Base", "2026-01-15T16:50:00Z", "2026-01-15T17:00:00Z"), "at 17:00 UTC").toBe(
      false,
    );
  });
});

describe("isDigestDue on the daylight saving days of Europe/Berlin", () => {
  it("isDigestDue hourly finds both 02:00 of the fall-back day 2026-10-25", () => {
    expect(
      due(HOURLY, "Europe/Berlin", "2026-10-24T23:50:00Z", "2026-10-25T00:00:00Z"),
      "first 02:00 (00:00 UTC)",
    ).toBe(true);
    expect(
      due(HOURLY, "Europe/Berlin", "2026-10-25T00:50:00Z", "2026-10-25T01:00:00Z"),
      "repeated 02:00 (01:00 UTC)",
    ).toBe(true);
    expect(due(HOURLY, "Europe/Berlin", "2026-10-25T00:00:00Z", "2026-10-25T00:50:00Z"), "between them").toBe(false);
  });

  it("isDigestDue hourly finds 25 digest times in the 25 hours of the fall-back day", () => {
    const runs = dueRuns(HOURLY, "Europe/Berlin", "2026-10-24T22:00:00Z", "2026-10-25T23:00:00Z");

    expect(runs, "due runs").toBe(25);
  });

  it("isDigestDue hourly finds 23 digest times in the 23 hours of the spring day 2026-03-29", () => {
    const runs = dueRuns(HOURLY, "Europe/Berlin", "2026-03-28T23:00:00Z", "2026-03-29T22:00:00Z");

    expect(runs, "due runs").toBe(23);
  });

  it("isDigestDue hourly adds no digest time for the skipped hour of the spring day", () => {
    expect(due(HOURLY, "Europe/Berlin", "2026-03-29T00:50:00Z", "2026-03-29T01:00:00Z"), "03:00 CEST").toBe(true);
    expect(due(HOURLY, "Europe/Berlin", "2026-03-29T01:00:00Z", "2026-03-29T01:50:00Z"), "after 03:00 CEST").toBe(
      false,
    );
  });

  it("isDigestDue daily at 02:30 counts only the first 02:30 of the fall-back day", () => {
    expect(due(daily("02:30"), "Europe/Berlin", "2026-10-25T00:20:00Z", "2026-10-25T00:30:00Z"), "first 02:30").toBe(
      true,
    );
    expect(due(daily("02:30"), "Europe/Berlin", "2026-10-25T01:20:00Z", "2026-10-25T01:30:00Z"), "repeated 02:30").toBe(
      false,
    );
    expect(
      due(daily("02:30"), "Europe/Berlin", "2026-10-25T00:30:00Z", "2026-10-25T02:30:00Z"),
      "after the first",
    ).toBe(false);
  });

  it("isDigestDue daily at 18:00 finds exactly one digest time on the fall-back day", () => {
    const runs = dueRuns(daily("18:00"), "Europe/Berlin", "2026-10-24T22:00:00Z", "2026-10-25T23:00:00Z");

    expect(runs, "due runs").toBe(1);
  });

  it("isDigestDue daily at 02:30 on the spring day is the first instant after the skipped time", () => {
    expect(due(daily("02:30"), "Europe/Berlin", "2026-03-29T00:50:00Z", "2026-03-29T01:00:00Z"), "03:00 CEST").toBe(
      true,
    );
    expect(due(daily("02:30"), "Europe/Berlin", "2026-03-29T00:40:00Z", "2026-03-29T00:50:00Z"), "01:50 CET").toBe(
      false,
    );
    expect(due(daily("02:30"), "Europe/Berlin", "2026-03-29T01:00:00Z", "2026-03-29T01:10:00Z"), "after it").toBe(
      false,
    );
  });

  it("isDigestDue daily at 02:30 finds exactly one digest time on the spring day", () => {
    const runs = dueRuns(daily("02:30"), "Europe/Berlin", "2026-03-28T23:00:00Z", "2026-03-29T23:00:00Z");

    expect(runs, "due runs").toBe(1);
  });

  it("isDigestDue daily at 18:00 finds exactly one digest time on the spring day", () => {
    const runs = dueRuns(daily("18:00"), "Europe/Berlin", "2026-03-28T23:00:00Z", "2026-03-29T22:00:00Z");

    expect(runs, "due runs").toBe(1);
  });
});

describe("isDigestDue and the work it does", () => {
  it.each([
    {
      case: "hourly with a gap of 120 minutes across the fall-back day",
      digest: HOURLY,
      previous: "2026-10-24T23:30:00Z",
      gap: 120,
    },
    {
      case: "daily with a gap of 1,500 minutes across the fall-back day",
      digest: daily("18:00"),
      previous: "2026-10-24T08:00:00Z",
      gap: 1500,
    },
  ])("isDigestDue converts at most 50 instants and builds one formatter for $case", ({ digest, previous, gap }) => {
    const counts = countIntl();
    try {
      const start = Date.parse(previous);

      const result = isDigestDue(digest, "Europe/Berlin", new Date(start), new Date(start + gap * MINUTE_MS));

      expect(result, "due").toBe(true);
      expect(counts.conversions(), "conversions").toBeLessThanOrEqual(50);
      expect(counts.formatters(), "formatters built").toBe(1);
    } finally {
      counts.restore();
    }
  });

  it.each([
    { case: "hourly with a gap of 121 minutes", digest: HOURLY, previous: "2026-10-24T23:30:00Z", gap: 121 },
    { case: "daily with a gap of 1,501 minutes", digest: daily("18:00"), previous: "2026-10-24T08:00:00Z", gap: 1501 },
  ])("isDigestDue converts nothing for $case", ({ digest, previous, gap }) => {
    const counts = countIntl();
    try {
      const start = Date.parse(previous);

      const result = isDigestDue(digest, "Europe/Berlin", new Date(start), new Date(start + gap * MINUTE_MS));

      expect(result, "due").toBe(true);
      expect(counts.conversions(), "conversions").toBe(0);
      expect(counts.formatters(), "formatters built").toBeLessThanOrEqual(1);
    } finally {
      counts.restore();
    }
  });

  it("isDigestDue builds at most one formatter for a call that is not due", () => {
    const counts = countIntl();
    try {
      const result = isDigestDue(
        daily("18:00"),
        "Europe/Berlin",
        new Date("2026-01-15T16:50:00Z"),
        new Date("2026-01-15T16:59:00Z"),
      );

      expect(result, "due").toBe(false);
      expect(counts.formatters(), "formatters built").toBeLessThanOrEqual(1);
      expect(counts.conversions(), "conversions").toBeLessThanOrEqual(50);
    } finally {
      counts.restore();
    }
  });

  it("isDigestDue converts nothing for immediate", () => {
    const counts = countIntl();
    try {
      isDigestDue(IMMEDIATE, "Europe/Berlin", new Date("2026-01-15T16:50:00Z"), new Date("2026-01-15T16:59:00Z"));

      expect(counts.conversions(), "conversions").toBe(0);
    } finally {
      counts.restore();
    }
  });
});
