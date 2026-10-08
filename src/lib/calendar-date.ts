/**
 * Calendar dates: "YYYY-MM-DD", with no time and no timezone - what a
 * check-in, check-out or block day is. Kept apart from instants on purpose:
 * pushing a calendar date through a `Date` in some local timezone shows the
 * wrong day for anyone west (or east) of UTC.
 *
 * In memory and in PostgreSQL (`date` columns) a calendar date is represented
 * as midnight UTC, which is what Prisma returns for `@db.Date`; these helpers
 * are the only conversions between that and the string form.
 */
export type CalendarDate = string;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isCalendarDate(value: string): boolean {
  try {
    toUtcDate(value);
    return true;
  } catch {
    return false;
  }
}

/** Midnight UTC of a calendar date, rejecting malformed and impossible ones. */
export function toUtcDate(value: CalendarDate): Date {
  const match = CALENDAR_DATE.exec(value);
  if (match) {
    const [, y, m, d] = match.map(Number);
    const date = new Date(Date.UTC(y!, m! - 1, d!));
    // Date.UTC rolls 2026-02-30 over into March; refuse instead.
    if (date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d) {
      return date;
    }
  }
  throw new RangeError(`Expected a calendar date as YYYY-MM-DD, got "${value}"`);
}

/** The calendar date of a midnight-UTC `Date`, as Prisma returns for `@db.Date`. */
export function fromUtcDate(date: Date): CalendarDate {
  if (date.getTime() % DAY_MS !== 0) {
    throw new RangeError(`Expected midnight UTC for a calendar date, got ${date.toISOString()}`);
  }
  return date.toISOString().slice(0, 10);
}

/** Whole days from `start` to `end`; negative when `end` is earlier. */
export function daysBetween(start: CalendarDate, end: CalendarDate): number {
  return Math.round((toUtcDate(end).getTime() - toUtcDate(start).getTime()) / DAY_MS);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromUtcDate(new Date(toUtcDate(date).getTime() + days * DAY_MS));
}
