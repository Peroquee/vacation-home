/**
 * Seasons (GitLab #118): named periods with their own nightly rate, per
 * property. A season runs from a start day to an end day, both included,
 * stored as month and day:
 *
 * - repeating every year (`year` null): e.g. 1 Jul - 31 Aug every summer,
 *   or 20 Dec - 6 Jan across New Year (the end before the start);
 * - or once (`year` set): from that year's start day to the end day, in the
 *   next year if the end comes before the start.
 *
 * Priority, the one rule: a one-off season beats a yearly one (a holiday
 * week inside the summer), and seasons of the same kind may not overlap.
 * Outside every season, the property's default rate applies.
 *
 * Pure and client-safe, without a validation library (./schema.ts has the
 * API's): the public estimate runs it in the browser.
 */
import { addDays, type CalendarDate } from "@/lib/calendar-date";

export type Season = {
  id: string;
  name: string;
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
  /** Null: every year. */
  year: number | null;
  rateMinor: number;
};

export type SeasonDates = Pick<Season, "startMonth" | "startDay" | "endMonth" | "endDay" | "year">;

/** A season as a pricing rule: everything but its id. */
export const seasonRule = (s: Season): Omit<Season, "id"> => ({
  name: s.name,
  startMonth: s.startMonth,
  startDay: s.startDay,
  endMonth: s.endMonth,
  endDay: s.endDay,
  year: s.year,
  rateMinor: s.rateMinor,
});

const monthDay = (month: number, day: number) => month * 100 + day;
const pad = (n: number) => String(n).padStart(2, "0");

/** Whether `month`/`day` is a day of the calendar (29 February counts). */
export function isMonthDay(month: number, day: number): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12) return false;
  // A leap year, so 29 February is a day a yearly season can name.
  return day >= 1 && day <= new Date(Date.UTC(2024, month, 0)).getUTCDate();
}

/** Whether the season runs into the next year (the end before the start). */
export const wraps = (s: SeasonDates) =>
  monthDay(s.endMonth, s.endDay) < monthDay(s.startMonth, s.startDay);

/** The one-off season's first and last day, or null for a yearly one. */
export function oneOffRange(s: SeasonDates): { start: CalendarDate; end: CalendarDate } | null {
  if (s.year === null) return null;
  const endYear = s.year + (wraps(s) ? 1 : 0);
  return {
    start: `${s.year}-${pad(s.startMonth)}-${pad(s.startDay)}`,
    end: `${endYear}-${pad(s.endMonth)}-${pad(s.endDay)}`,
  };
}

/** Whether the season covers the night of `date`. */
export function covers(s: SeasonDates, date: CalendarDate): boolean {
  const range = oneOffRange(s);
  if (range) return date >= range.start && date <= range.end;
  const md = monthDay(Number(date.slice(5, 7)), Number(date.slice(8, 10)));
  const start = monthDay(s.startMonth, s.startDay);
  const end = monthDay(s.endMonth, s.endDay);
  return wraps(s) ? md >= start || md <= end : md >= start && md <= end;
}

/** The season whose rate applies on `date`: a one-off one first. */
export function seasonOn<S extends SeasonDates>(seasons: S[], date: CalendarDate): S | null {
  return (
    seasons.find((s) => s.year !== null && covers(s, date)) ??
    seasons.find((s) => s.year === null && covers(s, date)) ??
    null
  );
}

/** The days of a leap year a yearly season covers, as day numbers 0-365. */
function yearlyDays(s: SeasonDates): Set<number> {
  const days = new Set<number>();
  let date = "2024-01-01";
  for (let i = 0; i < 366; i++, date = addDays(date, 1)) if (covers(s, date)) days.add(i);
  return days;
}

/**
 * The season among `others` that `season` would overlap, or null. Only
 * seasons of the same kind count: a one-off season may lie inside a yearly
 * one, and then wins (see seasonOn).
 */
export function overlapping<S extends SeasonDates & { id?: string }>(
  season: SeasonDates & { id?: string },
  others: S[],
): S | null {
  const range = oneOffRange(season);
  for (const other of others) {
    if (season.id !== undefined && other.id === season.id) continue;
    const theirs = oneOffRange(other);
    if (range && theirs) {
      if (range.start <= theirs.end && theirs.start <= range.end) return other;
    } else if (!range && !theirs) {
      const mine = yearlyDays(season);
      for (const day of yearlyDays(other)) if (mine.has(day)) return other;
    }
  }
  return null;
}
