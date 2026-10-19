/**
 * The reservation hold (GitLab #114). Server-side only.
 *
 * Accepting a request reserves it: its dates are held - against every
 * other booking and block, by the database too - until the first payment
 * arrives by its deadline (see src/lib/payment-terms/terms.ts). The hold
 * job, run every hour, then:
 * - lets a reservation unpaid after its deadline expire, freeing the dates;
 * - records the reminders and notices the emails go out from (GitLab #111):
 *   the deposit reminder, the expiry, the balance reminder, the balance
 *   overdue. A confirmed booking is never cancelled by the job; the owner
 *   decides.
 * Every step is idempotent - an event is recorded once per occasion, an
 * expiry happens once - so the job can run any number of times, and a
 * missed run is caught up by the next.
 *
 * The deposit received (reserved -> confirmed) and the rest (-> paid) are
 * recorded on the booking (GitLab #115; until then, its status). A
 * reservation confirmed in time is left alone by the job: the expiry only
 * ever moves a booking still reserved, under the property's lock.
 */
import type { BookingEventKind, Prisma } from "@/generated/prisma/client";
import { invalidateWindows } from "@/lib/availability/cache";
import { withPropertyLock } from "@/lib/availability/service";
import { addDays, type CalendarDate, fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import { db, type DbClient } from "@/lib/db";
import { syncBookingIncome } from "@/lib/finance/booking-income";
import { todayIn } from "@/lib/finance/recurring";
import { scheduleBookingSync } from "@/lib/google/outbound";
import { kickOutboundSync } from "@/lib/google/sync-worker";
import type { DeadlinesInput } from "@/lib/payment-terms/schema";
import { newReference } from "@/lib/booking-requests/reference";
import { parseSnapshot } from "@/lib/cancellation/schema";
import { getPaymentTerms } from "@/lib/payment-terms/service";
import {
  BALANCE_REMINDER_DAYS,
  DEPOSIT_REMINDER_DAYS,
  depositFor,
  holdFor,
} from "@/lib/payment-terms/terms";

import { check, locked, withRelations, type WriteResult } from "./service";

export const ONLY_REQUESTS = "only a request (an inquiry) can be reserved";
export const NOT_RESERVED = "can be changed only while the booking is reserved";
export const NO_BALANCE = "can be changed only for a booking with a balance still to pay";
export const NOT_PAST = "must not be in the past";
export const NOT_AFTER_BALANCE = "must not be after the balance is due";
export const NOT_BEFORE_DEPOSIT = "must not be before the deposit is due";

/**
 * Records an event once: again for the same occasion, nothing happens.
 * Whether it is new.
 */
export async function recordEvent(
  client: DbClient,
  bookingId: string,
  kind: BookingEventKind,
  key: string,
): Promise<boolean> {
  const { count } = await client.bookingEvent.createMany({
    data: [{ bookingId, kind, key }],
    skipDuplicates: true,
  });
  return count > 0;
}

/**
 * Accepts a request: inquiry -> reserved, with the property's payment terms
 * applied to the booking's total, today in its timezone. Refused with the
 * conflicts when its dates were taken meanwhile; of two accepted at once
 * for the same dates, one wins.
 */
export async function reserveBooking(id: string, now = new Date()): Promise<WriteResult> {
  const head = await db.booking.findUnique({ where: { id }, select: { propertyId: true } });
  if (!head) return { error: "not_found" };

  let stay = { checkIn: "", checkOut: "" };
  const result = await locked(
    head.propertyId,
    { error: "not_found" },
    async (tx) => {
      const current = await tx.booking.findUnique({
        where: { id },
        include: { property: { select: { timezone: true } } },
      });
      if (!current) return { error: "not_found" };
      if (current.status !== "inquiry") {
        return { error: "invalid", field: "status", message: ONLY_REQUESTS };
      }
      stay = { checkIn: fromUtcDate(current.checkIn), checkOut: fromUtcDate(current.checkOut) };
      const conflict = await check(tx, { propertyId: current.propertyId, ...stay }, id);
      if (conflict) return conflict;

      const today = todayIn(current.property.timezone, now);
      const terms = await getPaymentTerms(current.propertyId, tx);
      const hold = holdFor(
        {
          totalMinor: current.totalAmountMinor,
          touristTaxMinor: current.touristTaxMinor,
          checkIn: stay.checkIn,
          today,
        },
        terms,
      );
      const agreed = parseSnapshot(current.cancellationPolicy);
      // The schedule the guest agreed to at request time, else the property's now.
      const schedule = agreed ? agreed.schedule : terms.refundSchedule;
      const booking = await tx.booking.update({
        where: { id },
        data: {
          status: "reserved",
          reservedAt: now,
          // What the guest quotes on the transfer (GitLab #115); a request
          // from the public site has one already.
          ...(current.reference === null && { reference: newReference() }),
          depositAmountMinor: hold.depositAmountMinor,
          depositDueOn: toUtcDate(hold.depositDueOn),
          balanceDueOn: hold.balanceDueOn && toUtcDate(hold.balanceDueOn),
          expiredAt: null,
          // The cancellation policy (GitLab #116): the request's term stands,
          // a booking without one takes the property's now; the deposit it
          // keeps is the one the guest is now asked for, by today's total.
          cancellationPolicy: {
            depositNonRefundable: agreed?.depositNonRefundable ?? terms.depositNonRefundable,
            // When it is kept (GitLab #123): left out when there is none.
            ...(schedule && { schedule }),
            // Never the Kurtaxe: it goes back in full (GitLab #120).
            depositAmountMinor: depositFor(
              current.totalAmountMinor - current.touristTaxMinor,
              terms,
            ),
          },
        },
        include: withRelations,
      });
      await recordEvent(tx, id, "reserved", now.toISOString());
      await syncBookingIncome(id, tx, { justConfirmed: false });
      await scheduleBookingSync(id, tx);
      return { booking };
    },
    () => ({ ...stay, ignoreBookingId: id }),
  );
  if ("booking" in result) {
    invalidateWindows(head.propertyId, [{ start: stay.checkIn, end: stay.checkOut }]);
    kickOutboundSync();
  }
  return result;
}

/**
 * Moves a deadline by hand - say, the guest asked for a few more days. The
 * deposit's while reserved; the balance's while it is still to pay. Neither
 * into the past, nor the deposit after the balance. A new deadline gets
 * its own reminder.
 */
export async function changeDeadlines(
  id: string,
  input: DeadlinesInput,
  now = new Date(),
): Promise<WriteResult> {
  const head = await db.booking.findUnique({ where: { id }, select: { propertyId: true } });
  if (!head) return { error: "not_found" };
  return locked(head.propertyId, { error: "not_found" }, async (tx) => {
    const current = await tx.booking.findUnique({
      where: { id },
      include: { property: { select: { timezone: true } } },
    });
    if (!current) return { error: "not_found" };
    const today = todayIn(current.property.timezone, now);
    const deposit =
      input.depositDueOn ?? (current.depositDueOn && fromUtcDate(current.depositDueOn));
    const balance =
      input.balanceDueOn ?? (current.balanceDueOn && fromUtcDate(current.balanceDueOn));

    if (input.depositDueOn !== undefined) {
      if (current.status !== "reserved") {
        return { error: "invalid", field: "depositDueOn", message: NOT_RESERVED };
      }
      if (input.depositDueOn < today) {
        return { error: "invalid", field: "depositDueOn", message: NOT_PAST };
      }
    }
    if (input.balanceDueOn !== undefined) {
      if (!current.balanceDueOn || !["reserved", "confirmed"].includes(current.status)) {
        return { error: "invalid", field: "balanceDueOn", message: NO_BALANCE };
      }
      if (input.balanceDueOn < today) {
        return { error: "invalid", field: "balanceDueOn", message: NOT_PAST };
      }
    }
    if (current.status === "reserved" && deposit && balance && deposit > balance) {
      return input.depositDueOn !== undefined
        ? { error: "invalid", field: "depositDueOn", message: NOT_AFTER_BALANCE }
        : { error: "invalid", field: "balanceDueOn", message: NOT_BEFORE_DEPOSIT };
    }

    const booking = await tx.booking.update({
      where: { id },
      data: {
        ...(input.depositDueOn && { depositDueOn: toUtcDate(input.depositDueOn) }),
        ...(input.balanceDueOn && { balanceDueOn: toUtcDate(input.balanceDueOn) }),
      },
      include: withRelations,
    });
    return { booking };
  });
}

export type HoldRun = {
  expired: number;
  depositReminders: number;
  balanceReminders: number;
  balanceOverdue: number;
};

/** Lets one reservation expire, if it is still reserved under this deadline. */
async function expire(
  booking: { id: string; propertyId: string; depositDueOn: Date; checkIn: Date; checkOut: Date },
  now: Date,
): Promise<boolean> {
  const done = await withPropertyLock(booking.propertyId, async (tx) => {
    // Only if nothing changed: paid meanwhile, or the deadline extended.
    const { count } = await tx.booking.updateMany({
      where: { id: booking.id, status: "reserved", depositDueOn: booking.depositDueOn },
      data: { status: "expired", expiredAt: now },
    });
    if (count === 0) return false;
    await recordEvent(tx, booking.id, "reservation_expired", fromUtcDate(booking.depositDueOn));
    await syncBookingIncome(booking.id, tx, { justConfirmed: false });
    await scheduleBookingSync(booking.id, tx);
    return true;
  });
  if (done) {
    invalidateWindows(booking.propertyId, [
      { start: fromUtcDate(booking.checkIn), end: fromUtcDate(booking.checkOut) },
    ]);
  }
  return done ?? false;
}

/** Whether a reminder `days` ahead of `due` is due `today` (or was missed). */
const remindable = (today: CalendarDate, due: CalendarDate, days: number) =>
  today >= addDays(due, -days) && today <= due;

/**
 * One run of the hold job at `now`: expiries and the reminders and notices
 * due, each judged by today in the booking's property's timezone.
 */
export async function runHold(now = new Date()): Promise<HoldRun> {
  const run: HoldRun = { expired: 0, depositReminders: 0, balanceReminders: 0, balanceOverdue: 0 };
  const select = {
    id: true,
    propertyId: true,
    checkIn: true,
    checkOut: true,
    depositDueOn: true,
    balanceDueOn: true,
    property: { select: { timezone: true } },
  } satisfies Prisma.BookingSelect;

  const reserved = await db.booking.findMany({ where: { status: "reserved" }, select });
  for (const booking of reserved) {
    if (!booking.depositDueOn) continue;
    const today = todayIn(booking.property.timezone, now);
    const due = fromUtcDate(booking.depositDueOn);
    if (today > due) {
      if (await expire({ ...booking, depositDueOn: booking.depositDueOn }, now)) run.expired++;
    } else if (remindable(today, due, DEPOSIT_REMINDER_DAYS)) {
      if (await recordEvent(db, booking.id, "deposit_reminder", due)) run.depositReminders++;
    }
  }

  const owing = await db.booking.findMany({
    where: { status: "confirmed", balanceDueOn: { not: null } },
    select,
  });
  for (const booking of owing) {
    const today = todayIn(booking.property.timezone, now);
    const due = fromUtcDate(booking.balanceDueOn!);
    if (today > due) {
      if (await recordEvent(db, booking.id, "balance_overdue", due)) run.balanceOverdue++;
    } else if (remindable(today, due, BALANCE_REMINDER_DAYS)) {
      if (await recordEvent(db, booking.id, "balance_reminder", due)) run.balanceReminders++;
    }
  }
  if (run.expired > 0) kickOutboundSync();
  return run;
}
