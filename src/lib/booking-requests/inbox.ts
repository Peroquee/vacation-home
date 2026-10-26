/**
 * The owner's inbox for booking requests (GitLab #110). Server-side only.
 *
 * An open request is an inquiry from the public site. The owner accepts it
 * (reserves it: src/lib/bookings/hold.ts) or declines it, optionally with a
 * reason for the guest. Unanswered, it expires after the property's
 * `expiryDays` (src/lib/booking-requests/settings.ts), judged by the days
 * in the property's timezone. Each of these records an event for the
 * emails (GitLab #111).
 */
import type { Prisma } from "@/generated/prisma/client";
import { invalidateWindows } from "@/lib/availability/cache";
import { withPropertyLock } from "@/lib/availability/service";
import { recordEvent } from "@/lib/bookings/hold";
import { locked, withRelations, type WriteResult } from "@/lib/bookings/service";
import { addDays, type CalendarDate, fromUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";
import { todayIn } from "@/lib/finance/recurring";

import { DEFAULT_REQUEST_SETTINGS, getRequestSettingsFor } from "./settings";

/** An open request: an inquiry from the public site, not yet answered. */
export const OPEN_REQUEST = {
  status: "inquiry",
  source: "website",
} as const satisfies Prisma.BookingWhereInput;

export const ONLY_INQUIRIES = "only a request (an inquiry) can be declined";
export const REASON_MAX = 1000;

/** How many requests wait for an answer: the badge in the navigation. */
export function countOpenRequests(): Promise<number> {
  return db.booking.count({ where: OPEN_REQUEST });
}

/** The day a request expires unanswered: its last day to be answered. */
export function answerBy(receivedOn: CalendarDate, expiryDays: number): CalendarDate {
  return addDays(receivedOn, expiryDays);
}

/**
 * The booking's latest reinstatement (GitLab #135), to include with it. Its
 * key is the moment it was reinstated.
 */
export const LATEST_REINSTATEMENT = {
  where: { kind: "reinstated" as const },
  orderBy: { createdAt: "desc" as const },
  take: 1,
  select: { key: true },
};

/**
 * Where a request's answer window starts (GitLab #140): when it arrived, or
 * when it was last reinstated, so a reinstated request gets its days again
 * instead of expiring at the next hourly run.
 */
export function answerWindowStart(request: { createdAt: Date; events: { key: string }[] }): Date {
  const key = request.events[0]?.key;
  const reinstated = key ? new Date(key) : null;
  return reinstated && !Number.isNaN(reinstated.getTime()) && reinstated > request.createdAt
    ? reinstated
    : request.createdAt;
}

export type InboxRequest = {
  id: string;
  reference: string | null;
  property: { id: string; name: string };
  checkIn: CalendarDate;
  checkOut: CalendarDate;
  guestCount: number;
  name: string;
  email: string | null;
  phone: string | null;
  message: string | null;
  totalAmountMinor: number;
  currency: string;
  receivedAt: string;
  answerBy: CalendarDate;
};

/** Open requests, oldest first: the next to expire on top. */
export async function listOpenRequests(): Promise<InboxRequest[]> {
  const rows = await db.booking.findMany({
    where: OPEN_REQUEST,
    include: {
      property: { select: { id: true, name: true, timezone: true } },
      guest: { select: { name: true, email: true, phone: true } },
      events: LATEST_REINSTATEMENT,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const settings = await getRequestSettingsFor([...new Set(rows.map((r) => r.propertyId))]);
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    property: { id: row.property.id, name: row.property.name },
    checkIn: fromUtcDate(row.checkIn),
    checkOut: fromUtcDate(row.checkOut),
    guestCount: row.guestCount,
    // As given with the request; the guest record may be an older one.
    name: row.requesterName ?? row.guest.name,
    email: row.guest.email,
    phone: row.requesterPhone ?? row.guest.phone,
    message: row.guestMessage,
    totalAmountMinor: row.totalAmountMinor,
    currency: row.currency,
    receivedAt: row.createdAt.toISOString(),
    answerBy: answerBy(
      todayIn(row.property.timezone, answerWindowStart(row)),
      (settings.get(row.propertyId) ?? DEFAULT_REQUEST_SETTINGS).expiryDays,
    ),
  }));
}

export type AwaitingPayment = {
  id: string;
  reference: string | null;
  property: { id: string; name: string };
  guest: string;
  checkIn: CalendarDate;
  checkOut: CalendarDate;
  status: "reserved" | "confirmed";
  /** What is due next and by when: the first payment, or the balance. */
  due: "deposit" | "full" | "balance";
  amountMinor: number;
  dueOn: CalendarDate;
  currency: string;
};

/**
 * Bookings with money still to come: reserved ones (their first payment)
 * and confirmed ones with a balance, the earliest deadline first.
 */
export async function listAwaitingPayment(): Promise<AwaitingPayment[]> {
  const rows = await db.booking.findMany({
    where: {
      OR: [{ status: "reserved" }, { status: "confirmed", balanceDueOn: { not: null } }],
      depositAmountMinor: { not: null },
    },
    include: withRelations,
  });
  return rows
    .map((row): AwaitingPayment => {
      const reserved = row.status === "reserved";
      const full = row.balanceDueOn === null;
      return {
        id: row.id,
        reference: row.reference,
        property: row.property,
        guest: row.requesterName ?? row.guest.name,
        checkIn: fromUtcDate(row.checkIn),
        checkOut: fromUtcDate(row.checkOut),
        status: reserved ? "reserved" : "confirmed",
        due: reserved ? (full ? "full" : "deposit") : "balance",
        amountMinor: reserved
          ? row.depositAmountMinor!
          : row.totalAmountMinor - row.depositAmountMinor!,
        dueOn: fromUtcDate(reserved ? row.depositDueOn! : row.balanceDueOn!),
        currency: row.currency,
      };
    })
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id));
}

/**
 * Declines a request: inquiry -> cancelled, with the time and the reason
 * for the guest, if any. Only an inquiry; declining one again is refused.
 */
export async function declineRequest(
  id: string,
  reason: string | null,
  now = new Date(),
): Promise<WriteResult> {
  const head = await db.booking.findUnique({ where: { id }, select: { propertyId: true } });
  if (!head) return { error: "not_found" };
  const result = await locked(head.propertyId, { error: "not_found" }, async (tx) => {
    const { count } = await tx.booking.updateMany({
      where: { id, status: "inquiry" },
      data: { status: "cancelled", declinedAt: now, declineReason: reason },
    });
    if (count === 0) return { error: "invalid", field: "status", message: ONLY_INQUIRIES };
    await recordEvent(tx, id, "declined", now.toISOString());
    const booking = await tx.booking.findUniqueOrThrow({ where: { id }, include: withRelations });
    return { booking };
  });
  if ("booking" in result) {
    invalidateWindows(head.propertyId, [
      { start: fromUtcDate(result.booking.checkIn), end: fromUtcDate(result.booking.checkOut) },
    ]);
  }
  return result;
}

/**
 * Lets open requests not answered in time expire (inquiry -> expired), as
 * the hold job does reservations. Idempotent: an expired request is no
 * longer open. The number expired.
 */
export async function expireRequests(now = new Date()): Promise<number> {
  const open = await db.booking.findMany({
    where: OPEN_REQUEST,
    select: {
      id: true,
      propertyId: true,
      createdAt: true,
      checkIn: true,
      checkOut: true,
      property: { select: { timezone: true } },
      events: LATEST_REINSTATEMENT,
    },
  });
  const settings = await getRequestSettingsFor([...new Set(open.map((r) => r.propertyId))]);
  let expired = 0;
  for (const request of open) {
    const { timezone } = request.property;
    const last = answerBy(
      todayIn(timezone, answerWindowStart(request)),
      (settings.get(request.propertyId) ?? DEFAULT_REQUEST_SETTINGS).expiryDays,
    );
    if (todayIn(timezone, now) <= last) continue;
    const done = await withPropertyLock(request.propertyId, async (tx) => {
      // Only if still unanswered: accepted or declined meanwhile, it stays.
      const { count } = await tx.booking.updateMany({
        where: { id: request.id, ...OPEN_REQUEST },
        data: { status: "expired", expiredAt: now },
      });
      if (count > 0) await recordEvent(tx, request.id, "request_expired", last);
      return count > 0;
    });
    if (done) {
      expired++;
      invalidateWindows(request.propertyId, [
        { start: fromUtcDate(request.checkIn), end: fromUtcDate(request.checkOut) },
      ]);
    }
  }
  return expired;
}
