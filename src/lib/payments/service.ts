/**
 * Payments on a booking (GitLab #115). Server-side only.
 *
 * The owner records money as it arrives (or goes back, as a refund). What
 * has arrived moves a booking on, under the property's lock like every
 * booking write:
 * - reserved, once the first payment (the deposit, or the full amount at
 *   short notice) is in: confirmed;
 * - reserved or confirmed, once the total is in: paid.
 * Less than that - a partial or wrong amount - is recorded and shown as
 * such, and moves nothing. Taking a payment back (deleting it) never moves
 * a booking back: the owner decides.
 *
 * The ledger: each payment is one entry, dated the day it arrived - income
 * in "Booking income", a refund an expense in "Refunds". A booking with
 * payments takes its income from them alone: the entries #80's automation
 * generated for it are removed, and it generates none from then on
 * (src/lib/finance/booking-income.ts), so nothing is counted twice. An entry
 * edited by hand is left alone, as there.
 */
import type { BookingPayment, PaymentKind, PaymentMethod } from "@/generated/prisma/client";
import { invalidateWindows } from "@/lib/availability/cache";
import { recordEvent } from "@/lib/bookings/hold";
import { locked, withRelations, type WriteResult } from "@/lib/bookings/service";
import { type CalendarDate, fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import { db, type DbClient } from "@/lib/db";
import { syncBookingIncome } from "@/lib/finance/booking-income";
import { todayIn } from "@/lib/finance/recurring";
import { scheduleBookingSync } from "@/lib/google/outbound";
import { kickOutboundSync } from "@/lib/google/sync-worker";

export const NOT_PAYABLE = "can be recorded only for a reserved, confirmed or paid booking";
export const MORE_THAN_RECEIVED = "cannot be more than was received";
export const IN_THE_FUTURE = "must not be in the future";

export type PaymentInput = {
  kind: PaymentKind;
  method: PaymentMethod;
  amountMinor: number;
  receivedOn: CalendarDate;
  note: string | null;
};

export type PaymentDto = {
  id: string;
  kind: PaymentKind;
  method: PaymentMethod;
  amountMinor: number;
  receivedOn: CalendarDate;
  note: string | null;
};

export const toPaymentDto = (payment: BookingPayment): PaymentDto => ({
  id: payment.id,
  kind: payment.kind,
  method: payment.method,
  amountMinor: payment.amountMinor,
  receivedOn: fromUtcDate(payment.receivedOn),
  note: payment.note,
});

type Payments = Pick<BookingPayment, "kind" | "amountMinor">[];

/** Received less refunded. */
export function netReceived(payments: Payments): number {
  return payments.reduce(
    (sum, p) => sum + (p.kind === "refund" ? -p.amountMinor : p.amountMinor),
    0,
  );
}

export type NextDue = {
  kind: "deposit" | "full" | "balance";
  /** Still to come: what is due less what has arrived towards it. */
  amountMinor: number;
  dueOn: CalendarDate;
};

/** What the guest is to pay next, and by when; null when nothing is due. */
export function nextDue(
  booking: {
    status: string;
    totalAmountMinor: number;
    depositAmountMinor: number | null;
    depositDueOn: CalendarDate | null;
    balanceDueOn: CalendarDate | null;
  },
  net: number,
): NextDue | null {
  if (
    booking.status === "reserved" &&
    booking.depositAmountMinor !== null &&
    booking.depositDueOn
  ) {
    const full = booking.balanceDueOn === null;
    return {
      kind: full ? "full" : "deposit",
      amountMinor: Math.max(booking.depositAmountMinor - net, 0),
      dueOn: booking.depositDueOn,
    };
  }
  if (booking.status === "confirmed" && booking.balanceDueOn) {
    const rest = booking.totalAmountMinor - net;
    return rest > 0 ? { kind: "balance", amountMinor: rest, dueOn: booking.balanceDueOn } : null;
  }
  return null;
}

/** The ledger entry of a payment, in `tx`. */
async function enterInLedger(
  tx: DbClient,
  booking: { id: string; propertyId: string; currency: string },
  payment: BookingPayment,
): Promise<void> {
  const refund = payment.kind === "refund";
  const category = await tx.category.findUniqueOrThrow({
    where: { systemKey: refund ? "refunds" : "booking_income" },
    select: { id: true },
  });
  await tx.transaction.create({
    data: {
      propertyId: booking.propertyId,
      bookingId: booking.id,
      paymentId: payment.id,
      type: refund ? "expense" : "income",
      categoryId: category.id,
      amountMinor: payment.amountMinor,
      currency: booking.currency,
      date: payment.receivedOn,
      // The booking's id only, never guest personal data.
      description: `${refund ? "Refund" : "Payment"} (${payment.kind}) for booking ${booking.id}`,
    },
  });
}

export type RecordResult =
  | { payment: PaymentDto; booking: Awaited<ReturnType<typeof bookingAfter>> }
  | Exclude<WriteResult, { booking: unknown }>;

const bookingAfter = (tx: DbClient, id: string) =>
  tx.booking.findUniqueOrThrow({ where: { id }, include: withRelations });

/** Records a payment (or refund) and moves the booking on as far as it now goes. */
export async function recordPayment(
  bookingId: string,
  input: PaymentInput,
  now = new Date(),
): Promise<RecordResult> {
  const head = await db.booking.findUnique({
    where: { id: bookingId },
    select: { propertyId: true },
  });
  if (!head) return { error: "not_found" };

  let created: PaymentDto | null = null;
  const result = await locked(head.propertyId, { error: "not_found" }, async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { property: { select: { timezone: true } }, payments: true },
    });
    if (!booking) return { error: "not_found" };
    if (input.receivedOn > todayIn(booking.property.timezone, now)) {
      return { error: "invalid", field: "receivedOn", message: IN_THE_FUTURE };
    }
    const before = netReceived(booking.payments);
    if (input.kind === "refund") {
      if (input.amountMinor > before) {
        return { error: "invalid", field: "amountMinor", message: MORE_THAN_RECEIVED };
      }
    } else if (!["reserved", "confirmed", "paid"].includes(booking.status)) {
      return { error: "invalid", field: "kind", message: NOT_PAYABLE };
    }

    const payment = await tx.bookingPayment.create({
      data: {
        bookingId,
        kind: input.kind,
        method: input.method,
        amountMinor: input.amountMinor,
        receivedOn: toUtcDate(input.receivedOn),
        note: input.note,
      },
    });
    created = toPaymentDto(payment);
    await enterInLedger(tx, booking, payment);

    // Where the money now takes the booking.
    const net = before + (input.kind === "refund" ? -input.amountMinor : input.amountMinor);
    const first = booking.depositAmountMinor ?? booking.totalAmountMinor;
    let status = booking.status;
    if (status === "reserved" && net >= first) status = "confirmed";
    if ((status === "confirmed" || status === "reserved") && net >= booking.totalAmountMinor) {
      status = "paid";
    }
    if (status !== booking.status) {
      await tx.booking.update({ where: { id: bookingId }, data: { status } });
      if (booking.status === "reserved" && status === "confirmed") {
        await recordEvent(tx, bookingId, "deposit_received", payment.id);
      }
      if (status === "paid") await recordEvent(tx, bookingId, "fully_paid", payment.id);
      await scheduleBookingSync(bookingId, tx);
    }
    // Takes the income over from the automation (see above).
    await syncBookingIncome(bookingId, tx);
    return { booking: await bookingAfter(tx, bookingId) };
  });
  if (!("booking" in result)) return result;
  invalidateWindows(head.propertyId, [
    { start: fromUtcDate(result.booking.checkIn), end: fromUtcDate(result.booking.checkOut) },
  ]);
  kickOutboundSync();
  return { payment: created!, booking: result.booking };
}

/**
 * Takes back a payment recorded by mistake, with its ledger entry (unless
 * that was edited by hand). The booking's status stays as it is.
 */
export async function deletePayment(bookingId: string, paymentId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const payment = await tx.bookingPayment.findFirst({ where: { id: paymentId, bookingId } });
    if (!payment) return false;
    await tx.transaction.deleteMany({ where: { paymentId, detachedAt: null } });
    await tx.bookingPayment.delete({ where: { id: paymentId } });
    return true;
  });
}

/** A booking's payments, oldest first. */
export async function listPayments(bookingId: string): Promise<PaymentDto[]> {
  const rows = await db.bookingPayment.findMany({
    where: { bookingId },
    orderBy: [{ receivedOn: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toPaymentDto);
}
