/**
 * Which booking events are mailed to whom (GitLab #111), and whether an
 * email is still worth sending when its turn comes. Pure; server-side.
 */
import type { BookingEventKind, BookingStatus, EmailRecipient } from "@/generated/prisma/client";
import type { CalendarDate } from "@/lib/calendar-date";

export const RECIPIENTS: Record<BookingEventKind, readonly EmailRecipient[]> = {
  requested: ["guest", "owner"],
  reserved: ["guest"],
  deposit_reminder: ["guest"],
  reservation_expired: ["guest", "owner"],
  balance_reminder: ["guest"],
  balance_overdue: ["owner"],
  declined: ["guest"],
  request_expired: ["guest"],
  deposit_received: ["guest"],
  fully_paid: ["guest"],
  cancelled: ["guest", "owner"],
  // Recorded for the history and for #140's answer window; no email.
  reinstated: [],
};

/** Mail nothing older than this, whatever it is: a second guard. */
export const MAX_AGE_DAYS = 30;

export type Relevance = {
  status: BookingStatus;
  reservedAt: Date | null;
  depositDueOn: CalendarDate | null;
  balanceDueOn: CalendarDate | null;
  totalAmountMinor: number;
  /** Received less refunded. */
  received: number;
  /** Today in the property's timezone. */
  today: CalendarDate;
  /** Who cancelled, for a cancelled booking (GitLab #116). */
  cancelledBy: "guest" | "owner" | null;
};

/**
 * Why an email about `kind` (recorded with `key`) would no longer be true,
 * or null when it still is. Confirmations of what happened - a request
 * received, a deposit or the full amount received, a request declined -
 * stay true and are sent however late. What asks the guest to act, or
 * tells of a state, only while that still holds.
 */
export function irrelevance(
  kind: BookingEventKind,
  recipient: EmailRecipient,
  key: string,
  b: Relevance,
): string | null {
  switch (kind) {
    case "requested":
      // The owner is asked to answer only while there is something to answer.
      return recipient === "owner" && b.status !== "inquiry" ? "already answered" : null;
    case "reserved":
      if (b.status !== "reserved") return "no longer reserved";
      return b.reservedAt?.toISOString() === key ? null : "reserved again since";
    case "deposit_reminder":
      if (b.status !== "reserved") return "no longer reserved";
      if (b.depositDueOn !== key) return "the deadline changed";
      return b.today > key ? "the deadline has passed" : null;
    case "balance_reminder":
      if (b.status !== "confirmed" || b.received >= b.totalAmountMinor) return "no longer owing";
      if (b.balanceDueOn !== key) return "the deadline changed";
      return b.today > key ? "the deadline has passed" : null;
    case "balance_overdue":
      return b.status !== "confirmed" || b.received >= b.totalAmountMinor
        ? "no longer owing"
        : null;
    case "reservation_expired":
    case "request_expired":
      return b.status !== "expired" ? "no longer expired" : null;
    case "cancelled":
      if (b.status !== "cancelled") return "no longer cancelled";
      // The owner hears of the guest's cancellation; their own they know of.
      return recipient === "owner" && b.cancelledBy !== "guest" ? "cancelled by the owner" : null;
    case "deposit_received":
    case "fully_paid":
    case "declined":
      return null;
    case "reinstated":
      // Never queued (no recipients); here for completeness.
      return "nothing to tell";
  }
}
