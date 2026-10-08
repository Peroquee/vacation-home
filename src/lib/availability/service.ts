/**
 * Availability: the single source of truth for "can this range be booked".
 * Derived on every read from bookings and blocks; nothing is materialised.
 * The rules themselves live in ./rules.ts. Server-side only.
 *
 * Concurrency. Two layers keep a property from being double-booked:
 * - PostgreSQL's exclusion constraint `bookings_no_overlapping_confirmed`
 *   refuses overlapping confirmed bookings outright, whatever the timing;
 * - blocks live in another table, which no constraint can span. So a write
 *   that must not overlap a block - and every block write - goes through
 *   `withPropertyLock`, which serialises writers per property with a row
 *   lock, so a check and the write after it cannot be interleaved.
 */
import type { Booking, Block } from "@/generated/prisma/client";
import { type CalendarDate, fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import { assertNonEmptyRange, type DateRange } from "@/lib/date-range";
import { db, type DbClient } from "@/lib/db";
import { isExclusionViolation } from "@/lib/db-errors";

import {
  type BlockSpan,
  type BookingSpan,
  type Conflict,
  dailyAvailability,
  type DayAvailability,
  findConflicts,
} from "./rules";

export type { Conflict, DayAvailability };

/** The constraint behind the first layer; see the migration that adds it. */
export const OVERLAP_CONSTRAINT = "bookings_no_overlapping_confirmed";

/** Whether `error` is the database refusing an overlapping confirmed booking. */
export function isOverlapViolation(error: unknown): boolean {
  return isExclusionViolation(error, OVERLAP_CONSTRAINT);
}

const toBookingSpan = (
  b: Pick<Booking, "id" | "status" | "checkIn" | "checkOut">,
): BookingSpan => ({
  id: b.id,
  status: b.status,
  start: fromUtcDate(b.checkIn),
  end: fromUtcDate(b.checkOut),
});

const toBlockSpan = (b: Block): BlockSpan => ({
  id: b.id,
  reason: b.reason,
  origin: b.origin,
  start: fromUtcDate(b.startDate),
  end: fromUtcDate(b.endDate),
});

/** Bookings and blocks of a property touching `range`, cancelled bookings excluded. */
async function loadSpans(client: DbClient, propertyId: string, { start, end }: DateRange) {
  const [bookings, blocks] = await Promise.all([
    client.booking.findMany({
      where: {
        propertyId,
        status: { not: "cancelled" },
        checkIn: { lt: toUtcDate(end) },
        checkOut: { gt: toUtcDate(start) },
      },
      select: { id: true, status: true, checkIn: true, checkOut: true },
    }),
    client.block.findMany({
      where: { propertyId, startDate: { lt: toUtcDate(end) }, endDate: { gt: toUtcDate(start) } },
    }),
  ]);
  return { bookings: bookings.map(toBookingSpan), blocks: blocks.map(toBlockSpan) };
}

/**
 * Whether `[checkIn, checkOut)` can be booked at `propertyId`, and if not,
 * what is in the way. `ignoreBookingId` leaves out the booking being moved,
 * so changing a booking's dates is not refused because of itself.
 *
 * Inside `withPropertyLock`, pass its client, so the answer stays true until
 * the write that follows it commits.
 */
export async function isAvailable(
  propertyId: string,
  checkIn: CalendarDate,
  checkOut: CalendarDate,
  { ignoreBookingId, client = db }: { ignoreBookingId?: string; client?: DbClient } = {},
): Promise<{ available: boolean; conflicts: Conflict[] }> {
  const range = { start: checkIn, end: checkOut };
  assertNonEmptyRange(range);
  const { bookings, blocks } = await loadSpans(client, propertyId, range);
  const conflicts = findConflicts(range, bookings, blocks, { ignoreBookingId });
  return { available: conflicts.length === 0, conflicts };
}

/** Night-by-night availability over `[from, to)`, for calendar rendering. */
export async function getAvailability(
  propertyId: string,
  from: CalendarDate,
  to: CalendarDate,
): Promise<DayAvailability[]> {
  const range = { start: from, end: to };
  assertNonEmptyRange(range);
  const { bookings, blocks } = await loadSpans(db, propertyId, range);
  return dailyAvailability(range, bookings, blocks);
}

/**
 * Runs `work` in a transaction holding an exclusive lock on the property's
 * row, so writers of the same property's bookings and blocks take turns.
 * Returns null, without running `work`, when the property does not exist.
 *
 *   await withPropertyLock(propertyId, async (tx) => {
 *     const { available, conflicts } = await isAvailable(propertyId, checkIn, checkOut, { client: tx });
 *     if (!available) return { conflicts };
 *     return { booking: await tx.booking.create({ data }) };
 *   });
 */
export async function withPropertyLock<T>(
  propertyId: string,
  work: (tx: DbClient) => Promise<T>,
): Promise<T | null> {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM properties WHERE id = ${propertyId}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    return work(tx);
  });
}
