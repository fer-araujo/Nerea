// Calendar math in the atelier's own time zone. Netlify functions run in UTC,
// so "this month" computed from UTC would flip hours early on the last night of
// a month (21:00 on the 30th in Mexico City is already the 1st in UTC).
// Boundaries are derived from the IANA zone itself — never a hard-coded
// UTC-6 — so historical dates from when Mexico still observed daylight saving
// resolve correctly too.

export const ADMIN_TIME_ZONE = "America/Mexico_City";

export const PERIOD_KEYS = ["this-month", "last-month", "this-year"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const DEFAULT_PERIOD: PeriodKey = "this-month";

export interface CivilDate {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
}

/** A half-open interval: `start` is inside, `end` is not. */
export interface PeriodRange {
  start: Date;
  end: Date;
}

// Hoisted: building a DateTimeFormat is the expensive part.
const PARTS_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: ADMIN_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

interface ZonedParts extends CivilDate {
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(instant: Date): ZonedParts {
  const parts: Record<string, number> = {};
  for (const part of PARTS_FORMAT.formatToParts(instant)) {
    if (part.type !== "literal") {
      parts[part.type] = Number(part.value);
    }
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Zone offset from UTC at `instant`, in ms (negative west of Greenwich). */
function offsetAt(instant: Date): number {
  const p = zonedParts(instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const wholeSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return asUtc - wholeSeconds;
}

/** The instant at which `date` begins (00:00) in Mexico City. */
export function startOfMexicoDay({ year, month, day }: CivilDate): Date {
  // Treat the wall-clock midnight as if it were UTC, then correct by the
  // zone's offset. Re-check the offset at the corrected instant: if a
  // daylight-saving change sat between the two, the second pass fixes it.
  const wallClockAsUtc = Date.UTC(year, month - 1, day);
  const firstGuess = wallClockAsUtc - offsetAt(new Date(wallClockAsUtc));
  const settled = wallClockAsUtc - offsetAt(new Date(firstGuess));
  return new Date(settled);
}

/** The calendar date it is in Mexico City at `now`. */
export function mexicoToday(now: Date = new Date()): CivilDate {
  const { year, month, day } = zonedParts(now);
  return { year, month, day };
}

export function toIsoDate({ year, month, day }: CivilDate): string {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

export function mexicoTodayIso(now: Date = new Date()): string {
  return toIsoDate(mexicoToday(now));
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` -> a CivilDate, or null unless it is a real calendar day. */
export function parseIsoDate(text: string): CivilDate | null {
  const match = ISO_DATE_PATTERN.exec(text);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Round-trip through Date: 2026-02-30 would silently become March 2nd.
  const probe = new Date(Date.UTC(year, month - 1, day));
  const real =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
  return real ? { year, month, day } : null;
}

/**
 * A business date typed as `YYYY-MM-DD` -> the instant that day begins in
 * Mexico City. Stored as the document's `date`, so period queries compare it
 * against the same local-midnight boundaries. Throws on an invalid date:
 * validate with parseIsoDate() first.
 */
export function mexicoDateToInstant(text: string): Date {
  const civil = parseIsoDate(text);
  if (!civil) {
    throw new RangeError("not a valid YYYY-MM-DD date");
  }
  return startOfMexicoDay(civil);
}

/** The 1st of a month as a CivilDate; `month` may overflow or underflow. */
export function firstOfMonth(year: number, month: number): CivilDate {
  // Normalise month overflow/underflow (month 0 = December of the year before).
  const index = year * 12 + (month - 1);
  return { year: Math.floor(index / 12), month: (index % 12) + 1, day: 1 };
}

/**
 * The [start, end) range of a named period, in Mexico City time:
 * this month, last month, or this year (January 1st to the next January 1st).
 */
export function periodRange(
  key: PeriodKey,
  now: Date = new Date(),
): PeriodRange {
  const { year, month } = mexicoToday(now);

  switch (key) {
    case "this-month":
      return {
        start: startOfMexicoDay(firstOfMonth(year, month)),
        end: startOfMexicoDay(firstOfMonth(year, month + 1)),
      };
    case "last-month":
      return {
        start: startOfMexicoDay(firstOfMonth(year, month - 1)),
        end: startOfMexicoDay(firstOfMonth(year, month)),
      };
    case "this-year":
      return {
        start: startOfMexicoDay({ year, month: 1, day: 1 }),
        end: startOfMexicoDay({ year: year + 1, month: 1, day: 1 }),
      };
  }
}

/** `?period=` is user-controlled: anything unrecognised is the default. */
export function parsePeriodKey(raw: string | string[] | undefined): PeriodKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return PERIOD_KEYS.find((key) => key === value) ?? DEFAULT_PERIOD;
}
