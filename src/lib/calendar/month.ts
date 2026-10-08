/**
 * Month calendar layout, as pure functions over calendar dates: which days a
 * month grid shows, and where each stay or block sits in it. The calendar
 * component only draws what these return, so every edge case (month
 * boundaries, week splits, turnovers, overlaps) is tested here. Client-safe.
 *
 * Geometry: each day is two half-columns, so a week row has 14. A stay is
 * drawn from the middle of its check-in day to the middle of its check-out
 * day (check-out is exclusive), so on a turnover day one stay ends in the
 * morning half and the next starts in the afternoon half: two separate
 * shapes, never one bar.
 */
import { addDays, type CalendarDate, daysBetween, toUtcDate } from "@/lib/calendar-date";

/** "2026-07": a month, as the calendar's URL carries it. */
export type MonthKey = string;

/** 0 = Sunday … 6 = Saturday, as `Date#getUTCDay` counts. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: string): boolean {
  return MONTH_KEY.test(value);
}

export function monthOf(date: CalendarDate): MonthKey {
  return date.slice(0, 7);
}

/** The month `months` away: addMonths("2026-12", 1) is "2027-01". */
export function addMonths(month: MonthKey, months: number): MonthKey {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/**
 * The first day of the week where `locale` is spoken: Monday in most of the
 * world, Sunday in the US, Canada, Japan and others. From Intl where the
 * runtime knows it, otherwise from the region.
 */
export function weekStartFor(locale: string): Weekday {
  type WeekInfo = { firstDay: number };
  const tag = new Intl.Locale(locale) as Intl.Locale & {
    getWeekInfo?: () => WeekInfo;
    weekInfo?: WeekInfo;
  };
  try {
    const info = tag.getWeekInfo?.() ?? tag.weekInfo;
    // Intl counts 1 = Monday … 7 = Sunday.
    if (info) return (info.firstDay % 7) as Weekday;
  } catch {
    // Fall through to the region lists.
  }
  const region = tag.maximize().region ?? "";
  if (SUNDAY_REGIONS.has(region)) return 0;
  if (SATURDAY_REGIONS.has(region)) return 6;
  return 1;
}

// Only consulted where the runtime has no week data.
const SUNDAY_REGIONS = new Set(["US", "CA", "JP", "BR", "MX", "IL", "KR", "PH", "TW"]);
const SATURDAY_REGIONS = new Set([
  "AE",
  "AF",
  "BH",
  "DZ",
  "EG",
  "IQ",
  "IR",
  "JO",
  "KW",
  "OM",
  "QA",
  "SY",
]);

/**
 * The weeks a month grid shows: whole weeks from the one containing the 1st
 * to the one containing the last day, with the adjacent months' days filling
 * the edges. Each week is seven calendar dates.
 */
export function monthWeeks(month: MonthKey, weekStart: Weekday): CalendarDate[][] {
  const first = `${month}-01`;
  const last = addDays(`${addMonths(month, 1)}-01`, -1);
  const lead = (toUtcDate(first).getUTCDay() - weekStart + 7) % 7;
  const start = addDays(first, -lead);
  const days = daysBetween(start, last) + 1;
  const weeks = Math.ceil(days / 7);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)),
  );
}

/** The window a grid covers: `[first shown day, day after the last)`. */
export function gridRange(weeks: CalendarDate[][]): { start: CalendarDate; end: CalendarDate } {
  const lastWeek = weeks[weeks.length - 1]!;
  return { start: weeks[0]![0]!, end: addDays(lastWeek[6]!, 1) };
}

/** Anything drawn as a bar: a stay or a block, over `[start, end)`. */
export type Span = { key: string; start: CalendarDate; end: CalendarDate };

export type Segment<T extends Span> = {
  span: T;
  /** 1-based CSS grid lines in the week's 14 half-columns, end exclusive. */
  fromLine: number;
  toLine: number;
  /** The span carries on from the previous week or into the next. */
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** Row within the week, from 0, so overlapping spans stack. */
  lane: number;
};

/**
 * Where each span sits in each week: one segment per week it touches,
 * drawn from mid check-in to mid check-out and cut at the week's edges.
 * Within a week, segments are packed into lanes so overlapping ones (two
 * properties, or an inquiry beside a stay) stack instead of covering each
 * other; a span keeps the same lane throughout a week. Lanes are assigned
 * in the order given, so callers pass spans sorted the way they want them
 * stacked (e.g. by property, then start).
 */
export function layoutWeeks<T extends Span>(weeks: CalendarDate[][], spans: T[]): Segment<T>[][] {
  return weeks.map((week) => {
    const weekStart = week[0]!;
    const weekEnd = addDays(week[6]!, 1);
    const segments: Segment<T>[] = [];
    // Half-column occupancy per lane: lanes[l][half] is taken.
    const lanes: boolean[][] = [];

    for (const span of spans) {
      if (!(span.start < weekEnd && span.end > weekStart)) {
        // A stay ending on this week's first morning still shows its
        // check-out half; anything else outside the week is skipped.
        if (span.end !== weekStart) continue;
      }
      const continuesBefore = span.start < weekStart;
      const continuesAfter = span.end > week[6]!;
      // Half-columns are 0..13; a day d covers 2d (morning) and 2d+1 (afternoon).
      const from = continuesBefore ? 0 : daysBetween(weekStart, span.start) * 2 + 1;
      const to = continuesAfter ? 14 : daysBetween(weekStart, span.end) * 2 + 1;
      if (to <= from) continue;

      let lane = lanes.findIndex((taken) => !taken.slice(from, to).some(Boolean));
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(Array<boolean>(14).fill(false));
      }
      lanes[lane]!.fill(true, from, to);
      segments.push({
        span,
        fromLine: from + 1,
        toLine: to + 1,
        continuesBefore,
        continuesAfter,
        lane,
      });
    }
    return segments;
  });
}
