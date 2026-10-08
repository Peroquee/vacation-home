/**
 * The availability rules, as pure functions over plain data. The service
 * (./service.ts) loads the data and applies these; keeping the rules here
 * means every edge case can be tested without a database.
 *
 * - A stay or block covers the half-open range `[start, end)`: the end day is
 *   free for the next arrival.
 * - Confirmed bookings and blocks make dates unavailable.
 * - Inquiries are shown, but do not block: the dates can still be confirmed
 *   for someone else.
 * - Cancelled bookings are ignored entirely.
 */
import { addDays, type CalendarDate, daysBetween } from "@/lib/calendar-date";
import { assertNonEmptyRange, type DateRange, rangesOverlap } from "@/lib/date-range";

export type BookingStatus = "inquiry" | "confirmed" | "cancelled";

export type BookingSpan = DateRange & { id: string; status: BookingStatus };
export type BlockSpan = DateRange & {
  id: string;
  reason: string | null;
  origin: "manual" | "google";
};

export type Conflict =
  | { kind: "booking"; id: string; start: CalendarDate; end: CalendarDate }
  | {
      kind: "block";
      id: string;
      start: CalendarDate;
      end: CalendarDate;
      reason: string | null;
      origin: "manual" | "google";
    };

/** Whether a booking holds its dates against everyone else. */
export function blocksDates(status: BookingStatus): boolean {
  return status === "confirmed";
}

/**
 * What stands in the way of `range`: overlapping confirmed bookings (except
 * `ignoreBookingId`, the booking being moved) and overlapping blocks, in date
 * order. Empty means available.
 */
export function findConflicts(
  range: DateRange,
  bookings: BookingSpan[],
  blocks: BlockSpan[],
  { ignoreBookingId }: { ignoreBookingId?: string } = {},
): Conflict[] {
  assertNonEmptyRange(range);
  const conflicts: Conflict[] = [
    ...bookings
      .filter((b) => b.id !== ignoreBookingId && blocksDates(b.status) && rangesOverlap(range, b))
      .map((b): Conflict => ({ kind: "booking", id: b.id, start: b.start, end: b.end })),
    ...blocks
      .filter((b) => rangesOverlap(range, b))
      .map((b): Conflict => ({
        kind: "block",
        id: b.id,
        start: b.start,
        end: b.end,
        reason: b.reason,
        origin: b.origin,
      })),
  ];
  return conflicts.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/**
 * One night's state. `booked` and `blocked` cannot be booked; `inquiry` and
 * `available` can. When a confirmed booking and a block share a night, the
 * booking wins: it is what the owner needs to see.
 */
export type DayStatus = "available" | "inquiry" | "booked" | "blocked";

export type DayAvailability = {
  date: CalendarDate;
  status: DayStatus;
  /** The confirmed booking occupying this night, if any. */
  bookingId: string | null;
  /** Blocks covering this night. */
  blockIds: string[];
  /** Open inquiries for this night. */
  inquiryIds: string[];
  /** A confirmed stay ends this morning (the night itself may be free). */
  checkOut: boolean;
  /** A confirmed stay starts this day. */
  checkIn: boolean;
};

/** The longest range `dailyAvailability` will lay out: about two years. */
export const MAX_DAYS = 800;

/**
 * Night-by-night availability over `[from, to)`, for rendering a calendar.
 * `checkIn`/`checkOut` mark the turnover days, so a calendar can draw a stay
 * starting mid-cell on the day another leaves.
 */
export function dailyAvailability(
  { start: from, end: to }: DateRange,
  bookings: BookingSpan[],
  blocks: BlockSpan[],
): DayAvailability[] {
  assertNonEmptyRange({ start: from, end: to });
  const length = daysBetween(from, to);
  if (length > MAX_DAYS) {
    throw new RangeError(`at most ${MAX_DAYS} days at a time, asked for ${length}`);
  }

  // Validated once here; after that, canonical ISO dates compare correctly
  // as strings, which keeps the per-day loop cheap over long ranges.
  for (const span of [...bookings, ...blocks]) assertNonEmptyRange(span);
  const confirmed = bookings.filter((b) => blocksDates(b.status));
  const inquiries = bookings.filter((b) => b.status === "inquiry");
  const covers = (span: DateRange, date: CalendarDate) => span.start <= date && date < span.end;

  return Array.from({ length }, (_, offset) => {
    const date = addDays(from, offset);
    const booking = confirmed.find((b) => covers(b, date)) ?? null;
    const blockIds = blocks.filter((b) => covers(b, date)).map((b) => b.id);
    const inquiryIds = inquiries.filter((b) => covers(b, date)).map((b) => b.id);

    const status: DayStatus = booking
      ? "booked"
      : blockIds.length > 0
        ? "blocked"
        : inquiryIds.length > 0
          ? "inquiry"
          : "available";

    return {
      date,
      status,
      bookingId: booking?.id ?? null,
      blockIds,
      inquiryIds,
      checkIn: confirmed.some((b) => b.start === date),
      checkOut: confirmed.some((b) => b.end === date),
    };
  });
}
