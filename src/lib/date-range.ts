/**
 * Half-open ranges of calendar dates, `[start, end)`: the shape of every stay
 * and block in this app. `end` is the first day NOT covered, so ranges that
 * merely touch - one ends on the 18th, the next starts on the 18th - do not
 * overlap. That is what lets a guest arrive on another's departure day.
 */
import type { CalendarDate } from "@/lib/calendar-date";

export type DateRange = { start: CalendarDate; end: CalendarDate };

/**
 * Whether two half-open ranges share at least one night. ISO dates compare
 * correctly as strings, so no parsing is needed.
 */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.start < b.end && b.start < a.end;
}
