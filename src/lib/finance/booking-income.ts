/**
 * Income generated from bookings (GitLab #80). Server-side only.
 *
 * With income automation on for a property, a confirmed booking has two
 * ledger entries, linked to it and marked `generated`:
 * - `booking_accommodation`: the total less the cleaning fee and the
 *   Kurtaxe, in "Booking income";
 * - `booking_cleaning`: the cleaning fee, in "Cleaning fees";
 * - `booking_tourist_tax`: the Kurtaxe, in the pass-through "Kurtaxe
 *   (durchlaufend)", which is not revenue (GitLab #120).
 * They are created when the booking is confirmed, are dated on the check-in
 * day, and follow the booking's amounts and dates. A part worth nothing (no
 * cleaning fee) has no entry. Bookings confirmed while the automation was
 * off get theirs when it is switched on, or by `npm run income:backfill`
 * (GitLab #137, ./income-automation.ts), unless income typed in by hand is
 * already linked to them.
 *
 * When the booking is cancelled (or turned back into an inquiry), its
 * entries are deleted, or kept at zero, as the property's setting says.
 *
 * Generated entries are never duplicated: at most one of each per booking
 * (a unique index), found and updated on every change. An entry someone
 * edited by hand is detached (`detachedAt`) and left alone from then on.
 *
 * A booking with payments recorded (GitLab #115) is left to them: its
 * income is the payments' entries (src/lib/payments/service.ts), and its
 * generated entries are removed, so nothing is counted twice.
 *
 * Runs in the booking write's own transaction, so the ledger always matches
 * the booking. The description holds the booking's id only, never guest
 * personal data.
 */
import { isBooked } from "@/lib/bookings/values";
import type { GeneratedEntry } from "@/generated/prisma/client";
import { fromUtcDate } from "@/lib/calendar-date";
import type { DbClient } from "@/lib/db";

const CATEGORY: Record<GeneratedEntry, string> = {
  booking_accommodation: "booking_income",
  booking_cleaning: "cleaning_fees",
  // Collected for the municipality, never revenue (GitLab #120).
  booking_tourist_tax: "tourist_tax",
};

/**
 * What each part of a booking is worth: the Kurtaxe first (it is owed in
 * full), then the cleaning fee, and the rest is the accommodation.
 */
export function bookingIncomeParts(booking: {
  totalAmountMinor: number;
  cleaningFeeMinor: number;
  touristTaxMinor: number;
}): Record<GeneratedEntry, number> {
  const tax = Math.min(booking.touristTaxMinor, booking.totalAmountMinor);
  const cleaning = Math.min(booking.cleaningFeeMinor, booking.totalAmountMinor - tax);
  return {
    booking_accommodation: booking.totalAmountMinor - tax - cleaning,
    booking_cleaning: cleaning,
    booking_tourist_tax: tax,
  };
}

/**
 * Brings a booking's generated entries in line with it, in `tx` (the
 * booking write's transaction). Does nothing while the property's income
 * automation is off.
 */
export async function syncBookingIncome(
  bookingId: string,
  tx: DbClient,
  {
    justConfirmed = false,
    backfill = false,
  }: {
    /** The write confirmed it (created confirmed, or confirmed it now). */
    justConfirmed?: boolean;
    /**
     * Create the entries of a booked booking that has none (switched on,
     * or its last payment taken back), unless hand-typed income is linked.
     */
    backfill?: boolean;
  } = {},
): Promise<void> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    include: {
      property: { select: { incomeAutomation: true } },
      payments: { select: { id: true }, take: 1 },
    },
  });
  if (!booking) return;
  // Payments recorded (GitLab #115): the income comes from them alone, so
  // the generated entries go, and none come back.
  if (booking.payments.length > 0) {
    await tx.transaction.deleteMany({
      where: { bookingId, generated: { not: null }, detachedAt: null },
    });
    return;
  }
  const settings = booking.property.incomeAutomation;
  if (!settings?.enabled) return;

  const entries = await tx.transaction.findMany({
    where: { bookingId, generated: { not: null } },
  });
  // Hands off anything edited by hand.
  const managed = entries.filter((entry) => entry.detachedAt === null);

  // Income is counted once the stay is booked: a reservation awaiting its
  // deposit is not yet.
  if (!isBooked(booking.status)) {
    const ids = managed.map((entry) => entry.id);
    if (ids.length === 0) return;
    if (settings.onCancel === "delete") {
      await tx.transaction.deleteMany({ where: { id: { in: ids } } });
    } else {
      await tx.transaction.updateMany({ where: { id: { in: ids } }, data: { amountMinor: 0 } });
    }
    return;
  }

  // Entries are created on confirmation, or by a backfill. A booking
  // confirmed while the automation was off gets none when edited later: its
  // income may well have been entered by hand already.
  if (!justConfirmed && entries.length === 0) {
    if (!backfill || (await hasHandIncome(tx, bookingId))) return;
  }

  const parts = bookingIncomeParts(booking);
  for (const kind of Object.keys(CATEGORY) as GeneratedEntry[]) {
    const amountMinor = parts[kind];
    const existing = entries.find((entry) => entry.generated === kind);
    if (existing?.detachedAt) continue;
    if (amountMinor === 0) {
      if (existing) await tx.transaction.delete({ where: { id: existing.id } });
      continue;
    }
    const facts = {
      amountMinor,
      date: booking.checkIn,
      currency: booking.currency,
      description: `Booking ${booking.id} (${fromUtcDate(booking.checkIn)} to ${fromUtcDate(booking.checkOut)})`,
    };
    if (existing) {
      // The category is set once: a reassignment by hand is kept.
      await tx.transaction.update({ where: { id: existing.id }, data: facts });
    } else {
      const category = await tx.category.findUniqueOrThrow({
        where: { systemKey: CATEGORY[kind] },
        select: { id: true },
      });
      await tx.transaction.create({
        data: {
          ...facts,
          propertyId: booking.propertyId,
          bookingId: booking.id,
          type: "income",
          categoryId: category.id,
          generated: kind,
        },
      });
    }
  }
}

/**
 * Whether income typed in by hand (not generated, not a payment's) is
 * linked to the booking: then a backfill leaves it alone, as the owner
 * already counted it.
 */
export async function hasHandIncome(tx: DbClient, bookingId: string): Promise<boolean> {
  const typed = await tx.transaction.findFirst({
    where: { bookingId, type: "income", generated: null, paymentId: null },
    select: { id: true },
  });
  return typed !== null;
}
