/**
 * Booking persistence with availability enforcement. Server-side only.
 *
 * A booking that holds dates (status `confirmed`) is written inside
 * `withPropertyLock` after `isAvailable` has found nothing in the way, so a
 * refusal can name what is in the way. The database's own overlap rules
 * back this up; should one fire anyway, it is reported the same way.
 *
 * Bookings hold no guest personal data except free-text `notes`: the guest
 * is referenced by id only, so purging a guest (GitLab #100) never needs to
 * touch booking amounts or dates.
 */
import type { BookingSource, Prisma } from "@/generated/prisma/client";
import {
  type Conflict,
  isAvailable,
  isOverlapViolation,
  withPropertyLock,
} from "@/lib/availability/service";
import { type CalendarDate, fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import { db, type DbClient } from "@/lib/db";
import { escapeLike } from "@/lib/like";

import { calculateTotalMinor, nights } from "./pricing";
import type {
  ApiBookingSource,
  CreateBookingInput,
  ListBookingsQuery,
  UpdateBookingInput,
} from "./schema";

const toDbSource = (source: ApiBookingSource): BookingSource =>
  source === "booking.com" ? "booking_com" : source;
const toApiSource = (source: BookingSource): ApiBookingSource =>
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
 * Writes a booking, first making sure its dates are free when it will hold
 * them. `write` runs inside the property lock when a check is needed.
 */
async function writeChecked(
  stay: { propertyId: string; checkIn: CalendarDate; checkOut: CalendarDate },
  options: { needsCheck: boolean; ignoreBookingId?: string },
  write: (client: DbClient) => Promise<BookingWithRelations>,
): Promise<WriteResult> {
  try {
    if (!options.needsCheck) return { booking: await write(db) };

    const result = await withPropertyLock(stay.propertyId, async (tx) => {
      const { available, conflicts } = await isAvailable(
        stay.propertyId,
        stay.checkIn,
        stay.checkOut,
        { client: tx, ignoreBookingId: options.ignoreBookingId },
      );
      return available ? { booking: await write(tx) } : { error: "conflict" as const, conflicts };
    });
    return result ?? { error: "not_found" };
  } catch (error) {
    if (!isOverlapViolation(error)) throw error;
    // The database refused it after all: report what is in the way now.
    const { conflicts } = await isAvailable(stay.propertyId, stay.checkIn, stay.checkOut, {
      ignoreBookingId: options.ignoreBookingId,
    });
    return { error: "conflict", conflicts };
  }
}

/** The total, or a field error when it could not be stored. */
function total(
  stay: { checkIn: CalendarDate; checkOut: CalendarDate },
  rates: { nightlyRateMinor: number; cleaningFeeMinor: number },
): { totalAmountMinor: number } | { error: "invalid"; field: string; message: string } {
  try {
    return { totalAmountMinor: calculateTotalMinor({ ...stay, ...rates }) };
  } catch {
    return {
      error: "invalid",
      field: "nightlyRateMinor",
      message: "makes the total too large to store",
    };
  }
}

export async function createBooking(input: CreateBookingInput): Promise<WriteResult> {
  const [property, guest] = await Promise.all([
    db.property.findUnique({ where: { id: input.propertyId } }),
    db.guest.findUnique({ where: { id: input.guestId }, select: { id: true } }),
  ]);
  if (!property) return { error: "invalid", field: "propertyId", message: "does not exist" };
  if (property.archivedAt) {
    return { error: "invalid", field: "propertyId", message: "is archived" };
  }
  if (!guest) return { error: "invalid", field: "guestId", message: "does not exist" };

  // Copied from the property now; later changes there never touch this booking.
  const rates = {
    nightlyRateMinor: input.nightlyRateMinor ?? property.defaultNightlyRateMinor,
    cleaningFeeMinor: input.cleaningFeeMinor ?? property.defaultCleaningFeeMinor,
  };
  const manual = input.totalAmountMinor !== undefined;
  const calculated = manual ? { totalAmountMinor: input.totalAmountMinor! } : total(input, rates);
  if ("error" in calculated) return calculated;

  const data: Prisma.BookingUncheckedCreateInput = {
    propertyId: property.id,
    guestId: input.guestId,
    checkIn: toUtcDate(input.checkIn),
    checkOut: toUtcDate(input.checkOut),
    status: input.status,
    source: toDbSource(input.source),
    guestCount: input.guestCount,
    ...rates,
    totalAmountMinor: calculated.totalAmountMinor,
    totalIsManual: manual,
    currency: property.currency,
    notes: input.notes ?? null,
  };

  return writeChecked(input, { needsCheck: input.status === "confirmed" }, (client) =>
    client.booking.create({ data, include: withRelations }),
  );
}

export async function getBooking(id: string): Promise<BookingWithRelations | null> {
  return db.booking.findUnique({ where: { id }, include: withRelations });
}

/**
 * Applies a partial update. The total follows the dates and rates unless it
 * was set by hand (`totalAmountMinor: null` hands it back). When the result
 * holds dates and its dates or status changed, availability is checked again,
 * ignoring the booking itself.
 */
export async function updateBooking(id: string, input: UpdateBookingInput): Promise<WriteResult> {
  const current = await db.booking.findUnique({ where: { id } });
  if (!current) return { error: "not_found" };

  if (input.guestId && input.guestId !== current.guestId) {
    const guest = await db.guest.findUnique({ where: { id: input.guestId }, select: { id: true } });
    if (!guest) return { error: "invalid", field: "guestId", message: "does not exist" };
  }

  const stay = {
    propertyId: current.propertyId,
    checkIn: input.checkIn ?? fromUtcDate(current.checkIn),
    checkOut: input.checkOut ?? fromUtcDate(current.checkOut),
  };
  // Only one end given: the schema could not compare it with the stored one.
  if (stay.checkOut <= stay.checkIn) {
    return { error: "invalid", field: "checkOut", message: "must be after check-in" };
  }

  const rates = {
    nightlyRateMinor: input.nightlyRateMinor ?? current.nightlyRateMinor,
    cleaningFeeMinor: input.cleaningFeeMinor ?? current.cleaningFeeMinor,
  };
  const manual =
    input.totalAmountMinor === undefined ? current.totalIsManual : input.totalAmountMinor !== null;
  const totalAmount = manual
    ? { totalAmountMinor: input.totalAmountMinor ?? current.totalAmountMinor }
    : total(stay, rates);
  if ("error" in totalAmount) return totalAmount;

  const status = input.status ?? current.status;
  const datesChanged =
    stay.checkIn !== fromUtcDate(current.checkIn) ||
    stay.checkOut !== fromUtcDate(current.checkOut);
  const needsCheck = status === "confirmed" && (datesChanged || current.status !== "confirmed");

  const data: Prisma.BookingUncheckedUpdateInput = {
    guestId: input.guestId,
    checkIn: toUtcDate(stay.checkIn),
    checkOut: toUtcDate(stay.checkOut),
    status,
    source: input.source && toDbSource(input.source),
    guestCount: input.guestCount,
    ...rates,
    totalAmountMinor: totalAmount.totalAmountMinor,
    totalIsManual: manual,
    notes: input.notes,
  };

  return writeChecked(stay, { needsCheck, ignoreBookingId: id }, (client) =>
    client.booking.update({ where: { id }, data, include: withRelations }),
  );
}

/** Cancels a booking, keeping it for history. Cancelling twice is harmless. */
export async function cancelBooking(id: string): Promise<BookingWithRelations | null> {
  await db.booking.updateMany({
    where: { id, status: { not: "cancelled" } },
    data: { status: "cancelled" },
  });
  return getBooking(id);
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
          OR: [
            { name: { contains: escapeLike(query.q), mode: "insensitive" } },
            { email: { contains: escapeLike(query.q), mode: "insensitive" } },
          ],
        }
      : undefined,
  };
  const direction = query.sort === "-checkIn" ? "desc" : "asc";

  const [items, total] = await db.$transaction([
    db.booking.findMany({
      where,
      include: withRelations,
      orderBy: [{ checkIn: direction }, { createdAt: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.booking.count({ where }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}
