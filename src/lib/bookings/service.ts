/**
 * Booking persistence with availability enforcement. Server-side only.
 *
 * Every write happens inside `withPropertyLock`: it reads the current state
 * and writes without anyone changing the property's bookings in between. A
 * booking that holds dates (status `confirmed`) is written only after
 * `isAvailable` has found nothing in the way, so a refusal can name what is
 * in the way. The database's own overlap rules back this up; should one fire
 * anyway, it is reported the same way.
 *
 * Bookings hold no guest personal data except free-text `notes`: the guest
 * is referenced by id only, so purging a guest (GitLab #100) never needs to
 * touch booking amounts or dates.
 */
import type { BookingSource, Prisma } from "@/generated/prisma/client";
import { invalidateWindows } from "@/lib/availability/cache";
import {
  type Conflict,
  isAvailable,
  isOverlapViolation,
  withPropertyLock,
} from "@/lib/availability/service";
import { type CalendarDate, fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import { db, type DbClient } from "@/lib/db";
import { isPrismaError, raisedByDatabase } from "@/lib/db-errors";
import { escapeLike } from "@/lib/like";

import { calculateTotalMinor, nights } from "./pricing";
import {
  type ApiBookingSource,
  type CreateBookingInput,
  type ListBookingsQuery,
  stayProblem,
  type UpdateBookingInput,
} from "./schema";

export const toDbSource = (source: ApiBookingSource): BookingSource =>
  source === "booking.com" ? "booking_com" : source;
export const toApiSource = (source: BookingSource): ApiBookingSource =>
  source === "booking_com" ? "booking.com" : source;

const withRelations = {
  property: { select: { id: true, name: true } },
  guest: { select: { id: true, name: true } },
} satisfies Prisma.BookingInclude;

type BookingWithRelations = Prisma.BookingGetPayload<{ include: typeof withRelations }>;

/** The API's view of a booking: dates as YYYY-MM-DD, with its night count. */
export function toDto(booking: BookingWithRelations) {
  const { checkIn, checkOut, source, createdAt, updatedAt, ...rest } = booking;
  const stay = { checkIn: fromUtcDate(checkIn), checkOut: fromUtcDate(checkOut) };
  return {
    ...rest,
    ...stay,
    nights: nights(stay.checkIn, stay.checkOut),
    source: toApiSource(source),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

export type BookingDto = ReturnType<typeof toDto>;

export type WriteResult =
  | { booking: BookingWithRelations }
  | { error: "not_found" }
  | { error: "invalid"; field: string; message: string }
  | { error: "conflict"; conflicts: Conflict[] };

/**
 * Runs a booking write holding the property's lock, so it reads the current
 * state and writes without anyone changing the property's bookings in
 * between - no lost updates, and an availability check that stays true.
 * Database refusals are translated: an overlap into the conflicts now in the
 * way, a vanished guest into a field error. `ifMissing` answers for a
 * property that no longer exists.
 */
async function locked(
  propertyId: string,
  ifMissing: WriteResult,
  work: (tx: DbClient) => Promise<WriteResult>,
  stay?: () => { checkIn: CalendarDate; checkOut: CalendarDate; ignoreBookingId?: string },
): Promise<WriteResult> {
  try {
    return (await withPropertyLock(propertyId, work)) ?? ifMissing;
  } catch (error) {
    if (isOverlapViolation(error) && stay) {
      const { checkIn, checkOut, ignoreBookingId } = stay();
      const { conflicts } = await isAvailable(propertyId, checkIn, checkOut, { ignoreBookingId });
      return { error: "conflict", conflicts };
    }
    // P2003: the guest was deleted between our check and the write.
    if (isPrismaError(error, "P2003")) {
      return { error: "invalid", field: "guestId", message: "does not exist" };
    }
    // The guest was erased between our check and the write; the database
    // refuses to attach anything to an erased guest.
    if (raisedByDatabase(error, "guest_purged")) {
      return { error: "invalid", field: "guestId", message: "has been erased" };
    }
    throw error;
  }
}

/** The calculated total, or a field error when it could not be stored. */
function calculatedTotal(
  stay: { checkIn: CalendarDate; checkOut: CalendarDate },
  rates: { nightlyRateMinor: number; cleaningFeeMinor: number },
): { totalAmountMinor: number } | { error: "invalid"; field: string; message: string } {
  try {
    return { totalAmountMinor: calculateTotalMinor({ ...stay, ...rates }) };
  } catch {
    return {
      error: "invalid",
      field: "totalAmountMinor",
      message: "the calculated total is too large to store",
    };
  }
}

/** Whether a booking may take its dates, or what is in the way. */
async function check(
  tx: DbClient,
  stay: { propertyId: string; checkIn: CalendarDate; checkOut: CalendarDate },
  ignoreBookingId?: string,
): Promise<WriteResult | null> {
  const { available, conflicts } = await isAvailable(stay.propertyId, stay.checkIn, stay.checkOut, {
    client: tx,
    ignoreBookingId,
  });
  return available ? null : { error: "conflict", conflicts };
}

export async function createBooking(input: CreateBookingInput): Promise<WriteResult> {
  const [property, guest] = await Promise.all([
    db.property.findUnique({ where: { id: input.propertyId } }),
    db.guest.findUnique({ where: { id: input.guestId }, select: { id: true, purgedAt: true } }),
  ]);
  const noProperty = { error: "invalid", field: "propertyId", message: "does not exist" } as const;
  if (!property) return noProperty;
  if (property.archivedAt) {
    return { error: "invalid", field: "propertyId", message: "is archived" };
  }
  if (!guest) return { error: "invalid", field: "guestId", message: "does not exist" };
  if (guest.purgedAt) return { error: "invalid", field: "guestId", message: "has been erased" };

  // Copied from the property now; later changes there never touch this booking.
  const rates = {
    nightlyRateMinor: input.nightlyRateMinor ?? property.defaultNightlyRateMinor,
    cleaningFeeMinor: input.cleaningFeeMinor ?? property.defaultCleaningFeeMinor,
  };
  const manual = input.totalAmountMinor !== undefined;
  const amount = manual
    ? { totalAmountMinor: input.totalAmountMinor! }
    : calculatedTotal(input, rates);
  if ("error" in amount) return amount;

  const data: Prisma.BookingUncheckedCreateInput = {
    propertyId: property.id,
    guestId: input.guestId,
    checkIn: toUtcDate(input.checkIn),
    checkOut: toUtcDate(input.checkOut),
    status: input.status,
    source: toDbSource(input.source),
    guestCount: input.guestCount,
    ...rates,
    totalAmountMinor: amount.totalAmountMinor,
    totalIsManual: manual,
    currency: property.currency,
    notes: input.notes ?? null,
  };

  const result = await locked(
    property.id,
    noProperty,
    async (tx) => {
      if (input.status === "confirmed") {
        const conflict = await check(tx, input);
        if (conflict) return conflict;
      }
      return { booking: await tx.booking.create({ data, include: withRelations }) };
    },
    () => input,
  );
  if ("booking" in result) {
    invalidateWindows(property.id, [{ start: input.checkIn, end: input.checkOut }]);
  }
  return result;
}

export async function getBooking(id: string): Promise<BookingWithRelations | null> {
  return db.booking.findUnique({ where: { id }, include: withRelations });
}

/**
 * Applies a partial update, reading the booking afresh under the property
 * lock. The total follows the dates and rates unless it was set by hand
 * (`totalAmountMinor: null` hands it back). When the result holds dates and
 * its dates or status changed, availability is checked again, ignoring the
 * booking itself.
 */
export async function updateBooking(id: string, input: UpdateBookingInput): Promise<WriteResult> {
  // The property never changes, so it can be read before taking its lock.
  const head = await db.booking.findUnique({ where: { id }, select: { propertyId: true } });
  if (!head) return { error: "not_found" };

  let stay = { checkIn: "", checkOut: "" };
  let before = { start: "", end: "" };
  const result = await locked(
    head.propertyId,
    { error: "not_found" },
    async (tx) => {
      const current = await tx.booking.findUnique({
        where: { id },
        include: { guest: { select: { purgedAt: true } } },
      });
      if (!current) return { error: "not_found" };
      before = { start: fromUtcDate(current.checkIn), end: fromUtcDate(current.checkOut) };
      // An erased guest's bookings keep their facts but take no new notes.
      if (current.guest.purgedAt && input.notes && input.guestId === undefined) {
        return { error: "invalid", field: "notes", message: "cannot be set: the guest was erased" };
      }

      if (input.guestId && input.guestId !== current.guestId) {
        const guest = await tx.guest.findUnique({
          where: { id: input.guestId },
          select: { id: true, purgedAt: true },
        });
        if (!guest) return { error: "invalid", field: "guestId", message: "does not exist" };
        if (guest.purgedAt) {
          return { error: "invalid", field: "guestId", message: "has been erased" };
        }
      }

      stay = {
        checkIn: input.checkIn ?? fromUtcDate(current.checkIn),
        checkOut: input.checkOut ?? fromUtcDate(current.checkOut),
      };
      // With one end given, the schema could not judge the stay; judge the
      // merged one, reporting on the end that was sent.
      const problem = stayProblem(stay.checkIn, stay.checkOut);
      if (problem) {
        const field = input.checkOut === undefined ? "checkIn" : "checkOut";
        return { error: "invalid", field, message: problem };
      }

      const rates = {
        nightlyRateMinor: input.nightlyRateMinor ?? current.nightlyRateMinor,
        cleaningFeeMinor: input.cleaningFeeMinor ?? current.cleaningFeeMinor,
      };
      const manual =
        input.totalAmountMinor === undefined
          ? current.totalIsManual
          : input.totalAmountMinor !== null;
      const amount = manual
        ? { totalAmountMinor: input.totalAmountMinor ?? current.totalAmountMinor }
        : calculatedTotal(stay, rates);
      if ("error" in amount) return amount;

      const status = input.status ?? current.status;
      const datesChanged =
        stay.checkIn !== fromUtcDate(current.checkIn) ||
        stay.checkOut !== fromUtcDate(current.checkOut);
      if (status === "confirmed" && (datesChanged || current.status !== "confirmed")) {
        const conflict = await check(tx, { propertyId: current.propertyId, ...stay }, id);
        if (conflict) return conflict;
      }

      const booking = await tx.booking.update({
        where: { id },
        data: {
          guestId: input.guestId,
          checkIn: toUtcDate(stay.checkIn),
          checkOut: toUtcDate(stay.checkOut),
          status,
          source: input.source && toDbSource(input.source),
          guestCount: input.guestCount,
          ...rates,
          totalAmountMinor: amount.totalAmountMinor,
          totalIsManual: manual,
          notes: input.notes,
        },
        include: withRelations,
      });
      return { booking };
    },
    () => ({ ...stay, ignoreBookingId: id }),
  );
  // Calendar windows showing the old dates or the new ones are now stale.
  if ("booking" in result) {
    invalidateWindows(head.propertyId, [before, { start: stay.checkIn, end: stay.checkOut }]);
  }
  return result;
}

/**
 * Cancels a booking, keeping it for history, under the property lock so it
 * cannot interleave with an update. Cancelling twice is harmless.
 */
export async function cancelBooking(id: string): Promise<BookingWithRelations | null> {
  const head = await db.booking.findUnique({ where: { id }, select: { propertyId: true } });
  if (!head) return null;
  const result = await locked(head.propertyId, { error: "not_found" }, async (tx) => {
    await tx.booking.updateMany({
      where: { id, status: { not: "cancelled" } },
      data: { status: "cancelled" },
    });
    const booking = await tx.booking.findUnique({ where: { id }, include: withRelations });
    return booking ? { booking } : { error: "not_found" };
  });
  if (!("booking" in result)) return null;
  invalidateWindows(head.propertyId, [
    { start: fromUtcDate(result.booking.checkIn), end: fromUtcDate(result.booking.checkOut) },
  ]);
  return result.booking;
}

/** Bookings matching `query`, one page at a time, with the total count. */
export async function listBookings(query: ListBookingsQuery) {
  const where: Prisma.BookingWhereInput = {
    propertyId: query.propertyId,
    status: query.status && { in: query.status },
    source: query.source && { in: query.source.map(toDbSource) },
    // Stays overlapping [from, to): ending after `from`, starting before `to`.
    checkOut: query.from ? { gt: toUtcDate(query.from) } : undefined,
    checkIn: query.to ? { lt: toUtcDate(query.to) } : undefined,
    guest: query.q
      ? {
          // An erased guest is never found by search, here as in the typeahead.
          purgedAt: null,
          OR: [
            { name: { contains: escapeLike(query.q), mode: "insensitive" } },
            { email: { contains: escapeLike(query.q), mode: "insensitive" } },
          ],
        }
      : undefined,
  };
  const direction = query.sort === "-checkIn" ? "desc" : "asc";

  const [items, count] = await db.$transaction([
    db.booking.findMany({
      where,
      include: withRelations,
      orderBy: [{ checkIn: direction }, { createdAt: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.booking.count({ where }),
  ]);
  return { items, total: count, page: query.page, pageSize: query.pageSize };
}
