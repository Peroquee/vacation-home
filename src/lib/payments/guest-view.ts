/**
 * What the guest's own page shows (GitLab #115): their booking's status,
 * what to pay next, by when and to whom, with the GiroCode. Only what the
 * guest already knows or needs - no other guest, no owner notes. Server-side
 * only.
 */
import type { BookingStatus } from "@/generated/prisma/client";
import { type CalendarDate, fromUtcDate } from "@/lib/calendar-date";
import type { CancellationTerms } from "@/lib/cancellation/policy";
import { bookingPolicy } from "@/lib/cancellation/service";
import { db } from "@/lib/db";
import { getListing } from "@/lib/listing/service";

import { getBankDetails } from "./bank";
import { bookingForToken } from "./guest-link";
import { epcPayload, girocodeSvg, remittanceFor } from "./girocode";
import { formatIban } from "./iban";
import { netReceived, type NextDue, nextDue } from "./service";

export type GuestView = {
  reference: string | null;
  title: { en: string; de: string };
  checkIn: CalendarDate;
  checkOut: CalendarDate;
  guestCount: number;
  status: BookingStatus;
  totalAmountMinor: number;
  receivedMinor: number;
  currency: string;
  next: NextDue | null;
  /** The cancellation policy the guest agreed to (GitLab #116). */
  policy: CancellationTerms;
  transfer: {
    accountHolder: string;
    iban: string;
    bic: string | null;
    bankName: string | null;
    remittance: string;
    /** The GiroCode as an SVG data URI, for euros. */
    girocode: string | null;
  } | null;
};

/** The guest's view of the booking a token opens, or null. */
export async function guestView(token: string): Promise<GuestView | null> {
  const bookingId = await bookingForToken(token);
  if (!bookingId) return null;
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { property: { select: { id: true, name: true } }, payments: true },
  });
  if (!booking) return null;
  const [listing, bank] = await Promise.all([
    getListing(booking.propertyId),
    getBankDetails(booking.propertyId),
  ]);
  const received = netReceived(booking.payments);
  const next = nextDue(
    {
      status: booking.status,
      totalAmountMinor: booking.totalAmountMinor,
      depositAmountMinor: booking.depositAmountMinor,
      depositDueOn: booking.depositDueOn && fromUtcDate(booking.depositDueOn),
      balanceDueOn: booking.balanceDueOn && fromUtcDate(booking.balanceDueOn),
    },
    received,
  );

  let transfer: GuestView["transfer"] = null;
  if (next && next.amountMinor > 0 && bank && booking.reference) {
    const remittance = remittanceFor(booking.reference);
    const payload = epcPayload({
      ...bank,
      amountMinor: next.amountMinor,
      currency: booking.currency,
      remittance,
    });
    transfer = {
      accountHolder: bank.accountHolder,
      iban: formatIban(bank.iban),
      bic: bank.bic,
      bankName: bank.bankName,
      remittance,
      girocode: payload
        ? `data:image/svg+xml;base64,${Buffer.from(await girocodeSvg(payload)).toString("base64")}`
        : null,
    };
  }

  const titled = listing.titleEn || listing.titleDe;
  return {
    reference: booking.reference,
    title: titled
      ? { en: listing.titleEn, de: listing.titleDe }
      : { en: booking.property.name, de: "" },
    checkIn: fromUtcDate(booking.checkIn),
    checkOut: fromUtcDate(booking.checkOut),
    guestCount: booking.guestCount,
    status: booking.status,
    totalAmountMinor: booking.totalAmountMinor,
    receivedMinor: received,
    currency: booking.currency,
    next,
    policy: await bookingPolicy(booking),
    transfer,
  };
}
