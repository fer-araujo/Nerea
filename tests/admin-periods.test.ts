import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERIOD,
  mexicoDateToInstant,
  mexicoToday,
  mexicoTodayIso,
  parseIsoDate,
  parsePeriodKey,
  periodRange,
  startOfMexicoDay,
  toIsoDate,
} from "@/lib/admin/domain/periods";

const iso = (date: Date) => date.toISOString();

// Mexico City has been on UTC-6 all year since the 2022 reform, so a local
// midnight is 06:00 UTC. Before that it was UTC-5 in summer: the tests below
// include such a date to prove the boundaries come from the time-zone data,
// not from a hard-coded offset.

describe("startOfMexicoDay", () => {
  it("is 06:00 UTC for a current-era date (UTC-6)", () => {
    expect(iso(startOfMexicoDay({ year: 2026, month: 10, day: 1 }))).toBe(
      "2026-10-01T06:00:00.000Z",
    );
    expect(iso(startOfMexicoDay({ year: 2026, month: 1, day: 1 }))).toBe(
      "2026-01-01T06:00:00.000Z",
    );
  });

  it("follows the zone's historical daylight-saving time (UTC-5 in summer 2021)", () => {
    expect(iso(startOfMexicoDay({ year: 2021, month: 7, day: 1 }))).toBe(
      "2021-07-01T05:00:00.000Z",
    );
    expect(iso(startOfMexicoDay({ year: 2021, month: 1, day: 1 }))).toBe(
      "2021-01-01T06:00:00.000Z",
    );
  });
});

describe("mexicoToday", () => {
  it("is still the 30th in Mexico City when UTC has already reached the 1st", () => {
    // 03:00 UTC on Oct 1st = 21:00 on Sept 30th in Mexico City.
    const instant = new Date("2026-10-01T03:00:00Z");

    expect(mexicoToday(instant)).toEqual({ year: 2026, month: 9, day: 30 });
    expect(mexicoTodayIso(instant)).toBe("2026-09-30");
  });

  it("flips at local midnight exactly", () => {
    expect(mexicoTodayIso(new Date("2026-10-01T05:59:59.999Z"))).toBe("2026-09-30");
    expect(mexicoTodayIso(new Date("2026-10-01T06:00:00.000Z"))).toBe("2026-10-01");
  });
});

describe("periodRange: this month", () => {
  it("spans the Mexico-time month, as a half-open [start, end)", () => {
    const range = periodRange("this-month", new Date("2026-10-02T18:00:00Z"));

    expect(iso(range.start)).toBe("2026-10-01T06:00:00.000Z");
    expect(iso(range.end)).toBe("2026-11-01T06:00:00.000Z");
  });

  it("is still September on the last night of September, though UTC says October", () => {
    const range = periodRange("this-month", new Date("2026-10-01T03:00:00Z"));

    expect(iso(range.start)).toBe("2026-09-01T06:00:00.000Z");
    expect(iso(range.end)).toBe("2026-10-01T06:00:00.000Z");
  });

  it("belongs to the new month from the very instant it begins", () => {
    const before = periodRange("this-month", new Date("2026-10-01T05:59:59.999Z"));
    const at = periodRange("this-month", new Date("2026-10-01T06:00:00.000Z"));

    expect(iso(before.start)).toBe("2026-09-01T06:00:00.000Z");
    expect(iso(at.start)).toBe("2026-10-01T06:00:00.000Z");
  });

  it("rolls December over into the next year", () => {
    const range = periodRange("this-month", new Date("2026-12-15T12:00:00Z"));

    expect(iso(range.start)).toBe("2026-12-01T06:00:00.000Z");
    expect(iso(range.end)).toBe("2027-01-01T06:00:00.000Z");
  });

  it("uses the offset in force at each boundary (daylight saving began in April 2021)", () => {
    const range = periodRange("this-month", new Date("2021-04-15T12:00:00Z"));

    expect(iso(range.start)).toBe("2021-04-01T06:00:00.000Z"); // UTC-6
    expect(iso(range.end)).toBe("2021-05-01T05:00:00.000Z"); // UTC-5
  });
});

describe("periodRange: last month", () => {
  it("is the month before", () => {
    const range = periodRange("last-month", new Date("2026-10-02T18:00:00Z"));

    expect(iso(range.start)).toBe("2026-09-01T06:00:00.000Z");
    expect(iso(range.end)).toBe("2026-10-01T06:00:00.000Z");
  });

  it("crosses back over the year boundary in January", () => {
    const range = periodRange("last-month", new Date("2026-01-15T12:00:00Z"));

    expect(iso(range.start)).toBe("2025-12-01T06:00:00.000Z");
    expect(iso(range.end)).toBe("2026-01-01T06:00:00.000Z");
  });

  it("ends exactly where this month begins, with no gap and no overlap", () => {
    const now = new Date("2026-03-20T12:00:00Z");

    expect(periodRange("last-month", now).end.getTime()).toBe(
      periodRange("this-month", now).start.getTime(),
    );
  });
});

describe("periodRange: this year", () => {
  it("runs from January 1st to the next January 1st, Mexico time", () => {
    const range = periodRange("this-year", new Date("2026-10-02T18:00:00Z"));

    expect(iso(range.start)).toBe("2026-01-01T06:00:00.000Z");
    expect(iso(range.end)).toBe("2027-01-01T06:00:00.000Z");
  });

  it("is still the old year until local midnight on New Year's Eve", () => {
    // 05:59:59 UTC on Jan 1st = 23:59:59 on Dec 31st in Mexico City.
    const range = periodRange("this-year", new Date("2026-01-01T05:59:59Z"));

    expect(iso(range.start)).toBe("2025-01-01T06:00:00.000Z");
    expect(iso(range.end)).toBe("2026-01-01T06:00:00.000Z");
  });

  it("becomes the new year at 06:00 UTC", () => {
    const range = periodRange("this-year", new Date("2026-01-01T06:00:00Z"));

    expect(iso(range.start)).toBe("2026-01-01T06:00:00.000Z");
  });
});

describe("parseIsoDate", () => {
  it("accepts a real calendar date", () => {
    expect(parseIsoDate("2026-10-02")).toEqual({ year: 2026, month: 10, day: 2 });
    expect(parseIsoDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it.each([
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-10-00",
    "26-10-02",
    "2026-10-2",
    "2026/10/02",
    "2026-10-02T00:00:00Z",
    "",
    "not a date",
  ])("rejects %j", (text) => {
    expect(parseIsoDate(text)).toBeNull();
  });
});

describe("mexicoDateToInstant and toIsoDate", () => {
  it("turns a typed date into the instant that day begins in Mexico City", () => {
    expect(iso(mexicoDateToInstant("2026-10-02"))).toBe("2026-10-02T06:00:00.000Z");
  });

  it("throws on an invalid date instead of guessing", () => {
    expect(() => mexicoDateToInstant("2026-02-30")).toThrow(RangeError);
  });

  it("puts a date typed for the 1st inside that month's period", () => {
    const instant = mexicoDateToInstant("2026-10-01");
    const range = periodRange("this-month", new Date("2026-10-20T12:00:00Z"));

    expect(instant.getTime()).toBeGreaterThanOrEqual(range.start.getTime());
    expect(instant.getTime()).toBeLessThan(range.end.getTime());
  });

  it("formats a civil date with zero padding", () => {
    expect(toIsoDate({ year: 2026, month: 3, day: 7 })).toBe("2026-03-07");
  });
});

describe("parsePeriodKey", () => {
  it("accepts the three known periods", () => {
    expect(parsePeriodKey("this-month")).toBe("this-month");
    expect(parsePeriodKey("last-month")).toBe("last-month");
    expect(parsePeriodKey("this-year")).toBe("this-year");
  });

  it("falls back to the default for anything else, including repeated params", () => {
    expect(parsePeriodKey(undefined)).toBe(DEFAULT_PERIOD);
    expect(parsePeriodKey("forever")).toBe(DEFAULT_PERIOD);
    expect(parsePeriodKey("")).toBe(DEFAULT_PERIOD);
    expect(parsePeriodKey(["last-month", "this-year"])).toBe("last-month");
    expect(parsePeriodKey(["bogus"])).toBe(DEFAULT_PERIOD);
  });
});
