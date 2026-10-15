/**
 * What cancelling a booking would pay back, for the cancel dialog, and what
 * of a cancelled booking's refund is still to send (GitLab #116).
 * Server-side only.
 */
import { db } from "@/lib/db";
import { netReceived } from "@/lib/payments/service";

import { type CancellationTerms, guestRefund, type GuestRefund } from "./policy";
import { bookingPolicy } from "./service";

export type CancellationPreview = {
  /** The policy the booking is under. */
  policy: CancellationTerms;
  /** The guest cancelling: all but a non-refundable deposit back. */
  guest: GuestRefund;
  /** The owner cancelling: everything back. */
  ownerRefundMinor: number;
};

export async function cancellationPreview(id: string): Promise<CancellationPreview | null> {
  const booking = await db.booking.findUnique({
    where: { id },
    include: { payments: { select: { kind: true, amountMinor: true } } },
  });
  if (!booking) return null;
  const policy = await bookingPolicy(booking);
  const guest = guestRefund(policy, netReceived(booking.payments));
  return { policy, guest, ownerRefundMinor: guest.receivedMinor };
}

/**
 * Of a cancelled booking's refund, what is still to send: what was due less
 * the refunds recorded since it was cancelled. 0 for any other booking.
 */
export async function refundOutstanding(booking: {
  id: string;
  status: string;
  cancelledAt: Date | null;
  refundDueMinor: number | null;
}): Promise<number> {
  if (booking.status !== "cancelled" || !booking.cancelledAt || !booking.refundDueMinor) return 0;
  const { _sum } = await db.bookingPayment.aggregate({
    where: { bookingId: booking.id, kind: "refund", createdAt: { gte: booking.cancelledAt } },
    _sum: { amountMinor: true },
  });
  return Math.max(0, booking.refundDueMinor - (_sum.amountMinor ?? 0));
}
