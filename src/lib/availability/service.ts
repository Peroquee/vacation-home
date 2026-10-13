/**
 * Availability: the single source of truth for "can this range be booked".
 * Derived on every read from bookings and blocks; nothing is materialised.
 * The rules themselves live in ./rules.ts. Server-side only.
 *
 * Concurrency. The database itself refuses a double booking, whatever the
 * timing and whichever code writes:
 * - the exclusion constraint `bookings_no_overlapping_held` keeps the
 *   bookings of a property that hold their dates (HOLDING_STATUSES) apart;
 * - triggers raising `bookings_blocks_no_overlap` keep those bookings and
 *   blocks apart, taking the property row lock as they check.
 * `withPropertyLock` adds the same lock around an application-level
 * check-then-write, so the check can report *what* is in the way (a 409
 * naming the conflict) and stays true until the write commits.
 */
import type { Booking, Block } from "@/generated/prisma/client";
import { type CalendarDate, fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import { isUuid } from "@/lib/api";
import { findOverlappingBlocks } from "@/lib/blocks/service";
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

/** The database rules behind availability; see the migration that adds them. */
export const OVERLAP_CONSTRAINTS = [
  "bookings_no_overlapping_held",
  "bookings_blocks_no_overlap",
] as const;

/**
 * Whether `error` is the database refusing overlapping dates: a booking
 * holding its dates against another, or against a block.
 */
export function isOverlapViolation(error: unknown): boolean {
  return OVERLAP_CONSTRAINTS.some((name) => isExclusionViolation(error, name));
}

/** Raised for a property id that does not exist; callers answer 404. */
export class UnknownPropertyError extends Error {
  constructor(readonly propertyId: string) {
    super(`No property ${propertyId}`);
    this.name = "UnknownPropertyError";
  }
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

/**
 * Bookings and blocks of a property for `range`, cancelled bookings excluded.
 * Bookings ending on `range.start` are included too, so the first day can
 * show their check-out.
 */
async function loadSpans(client: DbClient, propertyId: string, range: DateRange) {
  if (!isUuid(propertyId)) throw new UnknownPropertyError(propertyId);
  const [property, bookings, blocks] = await Promise.all([
    client.property.findUnique({ where: { id: propertyId }, select: { id: true } }),
    client.booking.findMany({
      where: {
        propertyId,
        status: { notIn: ["cancelled", "expired"] },
        checkIn: { lt: toUtcDate(range.end) },
        checkOut: { gte: toUtcDate(range.start) },
      },
      select: { id: true, status: true, checkIn: true, checkOut: true },
    }),
    findOverlappingBlocks(propertyId, range, client),
  ]);
  if (!property) throw new UnknownPropertyError(propertyId);
  return { bookings: bookings.map(toBookingSpan), blocks: blocks.map(toBlockSpan) };
}

/**
 * Whether `[checkIn, checkOut)` can be booked at `propertyId`, and if not,
 * what is in the way. `ignoreBookingId` leaves out the booking being moved,
 * so changing a booking's dates is not refused because of itself.
 *
 * Inside `withPropertyLock`, pass its client, so the answer stays true until
 * the write that follows it commits. Throws `UnknownPropertyError` for a
 * property that does not exist, rather than calling its dates free.
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
 * Runs `work` in a transaction holding the property's row lock - the same
 * lock the database's overlap triggers take - so writers of one property's
 * bookings and blocks take turns. Returns null, without running `work`, when
 * the property does not exist.
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
  if (!isUuid(propertyId)) return null;
  return db.$transaction(
    async (tx) => {
      // Fail clearly after a while rather than queue indefinitely.
      await tx.$executeRaw`SET LOCAL lock_timeout = '10s'`;
      // NO KEY UPDATE: excludes other lock holders, but not the key-share
      // locks that foreign-key checks of unrelated inserts take.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM properties WHERE id = ${propertyId}::uuid FOR NO KEY UPDATE`;
      if (locked.length === 0) return null;
      return work(tx);
    },
    // Waiting for the lock counts against the transaction's time.
    { maxWait: 5_000, timeout: 20_000 },
  );
}
