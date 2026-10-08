/**
 * Half-open ranges of calendar dates, `[start, end)`: the shape of every stay
 * and block in this app. `end` is the first day NOT covered, so ranges that
 * merely touch - one ends on the 18th, the next starts on the 18th - do not
 * overlap. That is what lets a guest arrive on another's departure day.
 */
import { type CalendarDate, toUtcDate } from "@/lib/calendar-date";

export type DateRange = { start: CalendarDate; end: CalendarDate };

/**
 * Whether two half-open ranges share at least one night. The dates are
 * parsed, not compared as strings, so a malformed one ("2026-7-9") throws
 * instead of quietly comparing wrong.
 */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  const [aStart, aEnd, bStart, bEnd] = [a.start, a.end, b.start, b.end].map((date) =>
    toUtcDate(date).getTime(),
  );
  return aStart! < bEnd! && bStart! < aEnd!;
}

/** Throws unless `range` covers at least one night. */
export function assertNonEmptyRange({ start, end }: DateRange): void {
  if (toUtcDate(end) <= toUtcDate(start)) {
    throw new RangeError(`date range must end after it starts, got ${start} to ${end}`);
  }
}
