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
 * Every write also updates the booking's generated income entries
 * (src/lib/finance/booking-income.ts) and schedules its Google Calendar event
 * (src/lib/google/outbound.ts), in the same transaction.
 *
 * Bookings hold no guest personal data except free-text `notes` and, for a
 * request from the public site, what the guest sent with it: the guest is
 * referenced by id only, so purging a guest (GitLab #100) clears those and
 * never needs to touch booking amounts or dates.
 */
import type { Booking, BookingSource, Prisma } from "@/generated/prisma/client";
import { invalidateWindows } from "@/lib/availability/cache";
import {
  type Conflict,
  isAvailable,
  isOverlapViolation,
  withPropertyLock,
} from "@/lib/availability/service";
import { type CalendarDate, fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import { guestRefund } from "@/lib/cancellation/policy";
import type { CancelInput } from "@/lib/cancellation/schema";
import { bookingPolicy, policySnapshot } from "@/lib/cancellation/service";
import { db, type DbClient } from "@/lib/db";
import { isPrismaError, raisedByDatabase } from "@/lib/db-errors";
import { syncBookingIncome } from "@/lib/finance/booking-income";
import { scheduleBookingSync } from "@/lib/google/outbound";
import { kickOutboundSync } from "@/lib/google/sync-worker";
import { escapeLike } from "@/lib/like";

import { nights } from "./pricing";
import {
  parseBreakdown,
  type PriceBreakdown,
  priceStay,
  type PricingRules,
  type StayToPrice,
  type StoredBreakdown,
} from "@/lib/pricing/engine";
import { pricingRulesFor } from "@/lib/pricing/service";
import {
  type ApiBookingSource,
  type BookingSort,
  type CreateBookingInput,
  FLOW_ONLY,
  FLOW_STATUSES,
  holdsDates,
  isBooked,
  type ListBookingsQuery,
  stayProblem,
  type UpdateBookingInput,
  WEBSITE_ONLY,
} from "./schema";

export const toDbSource = (source: ApiBookingSource): BookingSource =>
  source === "booking.com" ? "booking_com" : source;
export const toApiSource = (source: BookingSource): ApiBookingSource =>
  source === "booking_com" ? "booking.com" : source;

export const withRelations = {
  property: { select: { id: true, name: true } },
  guest: { select: { id: true, name: true } },
} satisfies Prisma.BookingInclude;

type BookingWithRelations = Prisma.BookingGetPayload<{ include: typeof withRelations }>;

/** The API's view of a booking: dates as YYYY-MM-DD, with its night count. */
/**
 * How a booking's price was worked out (GitLab #118): its stored breakdown,
 * or, for one without (written outside the app), its total as legacy.
 */
export function breakdownOf(
  booking: Pick<Booking, "priceBreakdown" | "currency" | "totalAmountMinor">,
): StoredBreakdown {
  return (
    parseBreakdown(booking.priceBreakdown) ?? {
      version: 1,
      kind: "legacy",
      currency: booking.currency,
      totalMinor: booking.totalAmountMinor,
    }
  );
}

export function toDto(booking: BookingWithRelations) {
  const {
    checkIn,
    checkOut,
    source,
    createdAt,
    updatedAt,
    reservedAt,
    depositDueOn,
    balanceDueOn,
    expiredAt,
    declinedAt,
    privacyConsentAt,
    cancelledAt,
    ...rest
  } = booking;
  const stay = { checkIn: fromUtcDate(checkIn), checkOut: fromUtcDate(checkOut) };
  return {
    ...rest,
    ...stay,
    priceBreakdown: breakdownOf(booking),
    nights: nights(stay.checkIn, stay.checkOut),
    source: toApiSource(source),
    reservedAt: reservedAt?.toISOString() ?? null,
    depositDueOn: depositDueOn && fromUtcDate(depositDueOn),
    balanceDueOn: balanceDueOn && fromUtcDate(balanceDueOn),
    expiredAt: expiredAt?.toISOString() ?? null,
    declinedAt: declinedAt?.toISOString() ?? null,
    privacyConsentAt: privacyConsentAt?.toISOString() ?? null,
    cancelledAt: cancelledAt?.toISOString() ?? null,
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
export async function locked(
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

/**
 * The price from the one engine (GitLab #118): the total and its breakdown,
 * or a field error when it could not be stored.
 */
function calculatedPrice(
  rules: PricingRules,
  stay: StayToPrice,
):
  | { totalAmountMinor: number; priceBreakdown: PriceBreakdown }
  | { error: "invalid"; field: string; message: string } {
  try {
    const priceBreakdown = priceStay(rules, stay);
    return { totalAmountMinor: priceBreakdown.totalMinor, priceBreakdown };
  } catch {
    return {
      error: "invalid",
      field: "totalAmountMinor",
      message: "the calculated total is too large to store",
    };
  }
}

/** Whether a booking may take its dates, or what is in the way. */
export async function check(
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

/** What only a request from the public site (GitLab #109) records. */
export type WebsiteRequestFields = Pick<
  Prisma.BookingUncheckedCreateInput,
  | "reference"
  | "guestMessage"
  | "requesterName"
  | "requesterPhone"
  | "guestLocale"
  | "privacyConsentAt"
>;

/**
 * Creates a booking. `website` is for the public site's requests only
 * (src/lib/booking-requests/service.ts), which the API cannot create.
 */
export async function createBooking(
  input: Omit<CreateBookingInput, "source"> & { source: ApiBookingSource },
  website?: WebsiteRequestFields,
): Promise<WriteResult> {
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

  // The booking's own rate, if any (else its nights follow the seasons),
  // and the cleaning fee copied from the property now: later changes there
  // never touch this booking, nor does a season's (the breakdown is kept).
  const rates = {
    nightlyRateMinor: input.nightlyRateMinor ?? null,
    cleaningFeeMinor: input.cleaningFeeMinor ?? property.defaultCleaningFeeMinor,
  };
  const manual = input.totalAmountMinor !== undefined;
  const price = calculatedPrice(await pricingRulesFor(property), { ...input, ...rates });
  // A total set by hand stands even where the calculated one could not.
  if ("error" in price && !manual) return price;
  const calculated = "error" in price ? null : price;
  const amount = {
    totalAmountMinor: manual ? input.totalAmountMinor! : calculated!.totalAmountMinor,
    priceBreakdown: calculated?.priceBreakdown,
  };

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
    priceBreakdown: amount.priceBreakdown,
    currency: property.currency,
    notes: input.notes ?? null,
    ...website,
    // The owner and the guest are to hear of a request (GitLab #111).
    ...(website?.reference && {
      events: { create: { kind: "requested", key: website.reference } },
    }),
  };

  const result = await locked(
    property.id,
    noProperty,
    async (tx) => {
      if (holdsDates(input.status)) {
        const conflict = await check(tx, input);
        if (conflict) return conflict;
      }
      // The cancellation policy the guest agrees to (GitLab #116): shown with
      // the request's consent, or in force when the owner makes the booking.
      if (website || holdsDates(input.status)) {
        data.cancellationPolicy = await policySnapshot(property.id, amount.totalAmountMinor, tx);
      }
      const booking = await tx.booking.create({ data, include: withRelations });
      await syncBookingIncome(booking.id, tx, { justConfirmed: isBooked(booking.status) });
      await scheduleBookingSync(booking.id, tx);
      return { booking };
    },
    () => input,
  );
  if ("booking" in result) {
    invalidateWindows(property.id, [{ start: input.checkIn, end: input.checkOut }]);
    kickOutboundSync();
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
      if (input.source === "website" && current.source !== "website") {
        return { error: "invalid", field: "source", message: WEBSITE_ONLY };
      }
      // Kept as it is, a flow status may be sent back; changed to, never.
      if (
        input.status &&
        input.status !== current.status &&
        (FLOW_STATUSES as readonly string[]).includes(input.status)
      ) {
        return { error: "invalid", field: "status", message: FLOW_ONLY };
      }
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
        nightlyRateMinor:
          input.nightlyRateMinor === undefined ? current.nightlyRateMinor : input.nightlyRateMinor,
        cleaningFeeMinor: input.cleaningFeeMinor ?? current.cleaningFeeMinor,
      };
      const manual =
        input.totalAmountMinor === undefined
          ? current.totalIsManual
          : input.totalAmountMinor !== null;
      // Priced anew only when what the price is made of changes, or a
      // hand-set total is handed back: the agreed price stays otherwise,
      // whatever the seasons say now (GitLab #118).
      const repriced =
        stay.checkIn !== fromUtcDate(current.checkIn) ||
        stay.checkOut !== fromUtcDate(current.checkOut) ||
        rates.nightlyRateMinor !== current.nightlyRateMinor ||
        rates.cleaningFeeMinor !== current.cleaningFeeMinor ||
        (input.totalAmountMinor === null && current.totalIsManual);
      let price: { totalAmountMinor: number; priceBreakdown?: PriceBreakdown } = {
        totalAmountMinor: current.totalAmountMinor,
      };
      if (repriced) {
        const property = await tx.property.findUniqueOrThrow({ where: { id: current.propertyId } });
        const calculated = calculatedPrice(await pricingRulesFor(property, tx), {
          ...stay,
          ...rates,
        });
        if ("error" in calculated) {
          if (!manual) return calculated;
        } else {
          price = calculated;
        }
      }
      const amount = {
        totalAmountMinor: manual
          ? (input.totalAmountMinor ?? current.totalAmountMinor)
          : price.totalAmountMinor,
        priceBreakdown: price.priceBreakdown,
      };

      const status = input.status ?? current.status;
      const datesChanged =
        stay.checkIn !== fromUtcDate(current.checkIn) ||
        stay.checkOut !== fromUtcDate(current.checkOut);
      if (holdsDates(status) && (datesChanged || !holdsDates(current.status))) {
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
          priceBreakdown: amount.priceBreakdown,
          notes: input.notes,
        },
        include: withRelations,
      });
      await syncBookingIncome(id, tx, {
        justConfirmed: isBooked(status) && !isBooked(current.status),
      });
      await scheduleBookingSync(id, tx);
      return { booking };
    },
    () => ({ ...stay, ignoreBookingId: id }),
  );
  // Calendar windows showing the old dates or the new ones are now stale.
  if ("booking" in result) {
    invalidateWindows(head.propertyId, [before, { start: stay.checkIn, end: stay.checkOut }]);
    kickOutboundSync();
  }
  return result;
}

/**
 * Cancels a booking (GitLab #116): its dates are freed, the record is kept -
 * bookings are never deleted, they are accounting records. The owner
 * cancelling refunds everything received; the guest cancelling, what the
 * booking's cancellation policy gives back (all but a non-refundable
 * deposit). `refundMinor` overrides either, up to what was
 * received. The refund itself is recorded as a payment once sent; until
 * then the booking shows it as due. Idempotent: a cancelled booking stays
 * as it was cancelled.
 */
export async function cancelBooking(
  id: string,
  input: CancelInput = { by: "owner" },
  now = new Date(),
): Promise<WriteResult> {
  const head = await db.booking.findUnique({ where: { id }, select: { propertyId: true } });
  if (!head) return { error: "not_found" };
  let changed = false;
  const result = await locked(head.propertyId, { error: "not_found" }, async (tx) => {
    const current = await tx.booking.findUnique({
      where: { id },
      include: { payments: { select: { kind: true, amountMinor: true } } },
    });
    if (!current) return { error: "not_found" };
    if (current.status !== "cancelled") {
      const received = Math.max(0, receivedOf(current.payments));
      const refund =
        input.refundMinor ??
        (input.by === "owner"
          ? received
          : guestRefund(await bookingPolicy(current, tx), received).refundMinor);
      if (refund > received) {
        return { error: "invalid", field: "refundMinor", message: REFUND_ABOVE_RECEIVED };
      }
      await tx.booking.update({
        where: { id },
        data: {
          status: "cancelled",
          cancelledBy: input.by,
          cancelledAt: now,
          refundDueMinor: refund,
        },
      });
      // The guest hears of it, and the owner of a guest's cancellation (GitLab #111).
      await tx.bookingEvent.createMany({
        data: [{ bookingId: id, kind: "cancelled", key: now.toISOString() }],
        skipDuplicates: true,
      });
      await syncBookingIncome(id, tx);
      await scheduleBookingSync(id, tx);
      changed = true;
    }
    const booking = await tx.booking.findUnique({ where: { id }, include: withRelations });
    return booking ? { booking } : { error: "not_found" };
  });
  if (!("booking" in result)) return result;
  if (changed) {
    kickOutboundSync();
    invalidateWindows(head.propertyId, [
      { start: fromUtcDate(result.booking.checkIn), end: fromUtcDate(result.booking.checkOut) },
    ]);
  }
  return result;
}

export const REFUND_ABOVE_RECEIVED = "cannot be more than was received";

/** Received less refunded, from a booking's payments. */
function receivedOf(payments: { kind: string; amountMinor: number }[]): number {
  return payments.reduce(
    (sum, p) => sum + (p.kind === "refund" ? -p.amountMinor : p.amountMinor),
    0,
  );
}

/**
 * The ORDER BY for a list sort. Ties fall back to check-in, then creation,
 * so pages never shuffle between requests.
 */
function orderFor(sort: BookingSort): Prisma.BookingOrderByWithRelationInput[] {
  const direction = sort.startsWith("-") ? "desc" : "asc";
  const column = sort.replace(/^-/, "") as Exclude<BookingSort, `-${string}`>;
  const primary: Record<typeof column, Prisma.BookingOrderByWithRelationInput> = {
    checkIn: { checkIn: direction },
    guest: { guest: { name: direction } },
    property: { property: { name: direction } },
    status: { status: direction },
    source: { source: direction },
    total: { totalAmountMinor: direction },
  };
  const ties: Prisma.BookingOrderByWithRelationInput[] = [
    ...(column === "checkIn" ? [] : [{ checkIn: "asc" as const }]),
    { createdAt: "asc" },
  ];
  return [primary[column], ...ties];
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
  const [items, count] = await db.$transaction([
    db.booking.findMany({
      where,
      include: withRelations,
      orderBy: orderFor(query.sort),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.booking.count({ where }),
  ]);
  return { items, total: count, page: query.page, pageSize: query.pageSize };
}

/** Every booking of one guest, newest stay first: the guest's history. */
export async function listGuestBookings(guestId: string): Promise<BookingWithRelations[]> {
  return db.booking.findMany({
    where: { guestId },
    include: withRelations,
    orderBy: [{ checkIn: "desc" }, { createdAt: "asc" }],
  });
}
