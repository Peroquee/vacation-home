/**
 * Income generated from bookings (GitLab #80). Server-side only.
 *
 * With income automation on for a property, a confirmed booking has two
 * ledger entries, linked to it and marked `generated`:
 * - `booking_accommodation`: the total less the cleaning fee, in "Booking
 *   income";
 * - `booking_cleaning`: the cleaning fee, in "Cleaning fees".
 * They are created when the booking is confirmed (bookings confirmed before
 * the automation was on are not backfilled), are dated on the check-in day,
 * and follow the booking's amounts and dates. A part worth nothing (no
 * cleaning fee) has no entry.
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
};

/** What each part of a booking is worth. */
export function bookingIncomeParts(booking: {
  totalAmountMinor: number;
  cleaningFeeMinor: number;
}): Record<GeneratedEntry, number> {
  const cleaning = Math.min(booking.cleaningFeeMinor, booking.totalAmountMinor);
  return {
    booking_accommodation: booking.totalAmountMinor - cleaning,
    booking_cleaning: cleaning,
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
  /** The write confirmed it (created confirmed, or confirmed it now). */
  { justConfirmed = false }: { justConfirmed?: boolean } = {},
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

  // Entries are created on confirmation. A booking confirmed before the
  // automation was turned on gets none when edited later: its income may
  // well have been entered by hand already.
  if (!justConfirmed && entries.length === 0) return;

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
