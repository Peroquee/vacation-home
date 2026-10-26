/**
 * Bookings whose status disagrees with their own record (GitLab #135): left
 * by status changes made before every change had to go through its action.
 * Read only: `npm run bookings:check` lists them for the owner to look at,
 * and nothing here changes a booking. A reservation without its terms the
 * database refuses itself (`bookings_reserved_has_terms`). Server-side only.
 */
import { db } from "@/lib/db";

export type StatusProblem =
  | "cancelled_without_cancellation"
  | "cancellation_on_active_booking"
  | "website_booking_not_paid_enough";

export const PROBLEM_TEXT: Record<StatusProblem, string> = {
  cancelled_without_cancellation:
    "cancelled, but with no cancellation recorded (when, by whom, the refund)",
  cancellation_on_active_booking: "not cancelled, but still carrying an old cancellation",
  website_booking_not_paid_enough:
    "from the website and confirmed or paid, without the payments for it",
};

export type StatusFinding = { bookingId: string; status: string; problem: StatusProblem };

/** Every booking with a status problem, oldest first; one line per problem. */
export async function findStatusProblems(): Promise<StatusFinding[]> {
  const bookings = await db.booking.findMany({
    where: {
      OR: [
        { status: "cancelled", cancelledAt: null },
        {
          status: { not: "cancelled" },
          OR: [
            { cancelledAt: { not: null } },
            { cancelledBy: { not: null } },
            { refundDueMinor: { not: null } },
          ],
        },
        { source: "website", status: { in: ["confirmed", "paid"] } },
      ],
    },
    select: {
      id: true,
      status: true,
      source: true,
      cancelledAt: true,
      cancelledBy: true,
      refundDueMinor: true,
      totalAmountMinor: true,
      depositAmountMinor: true,
      payments: { select: { kind: true, amountMinor: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const findings: StatusFinding[] = [];
  for (const b of bookings) {
    const found = (problem: StatusProblem) =>
      findings.push({ bookingId: b.id, status: b.status, problem });
    if (b.status === "cancelled") {
      if (!b.cancelledAt) found("cancelled_without_cancellation");
    } else if (b.cancelledAt || b.cancelledBy || b.refundDueMinor !== null) {
      found("cancellation_on_active_booking");
    }
    if (b.source === "website" && (b.status === "confirmed" || b.status === "paid")) {
      const received = b.payments.reduce(
        (sum, p) => sum + (p.kind === "refund" ? -p.amountMinor : p.amountMinor),
        0,
      );
      // Confirmed means the deposit came in; one confirmed by hand has none
      // asked for, and needs at least something received.
      const needed = b.status === "paid" ? b.totalAmountMinor : (b.depositAmountMinor ?? 1);
      if (received < needed) found("website_booking_not_paid_enough");
    }
  }
  return findings;
}
