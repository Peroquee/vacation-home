/**
 * Retention of requests that came to nothing (GitLab #110): declined and
 * expired requests from the public site are anonymised once the property's
 * `retentionMonths` have passed since - by the DSGVO purge
 * (src/lib/guests/purge.ts), so exactly as if the owner had erased the
 * guest. Only a guest whose every booking is such a request, old enough: a
 * guest with any other booking keeps their data for it. Server-side only.
 */
import type { Booking } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { purgeGuest } from "@/lib/guests/purge";

import { DEFAULT_REQUEST_SETTINGS, getRequestSettingsFor } from "./settings";

/** `months` calendar months before `date`. */
export function monthsBefore(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() - months);
  return result;
}

type Ended = Pick<Booking, "propertyId" | "source" | "status" | "declinedAt" | "expiredAt">;

/** When a booking ended as a request that came to nothing, or null if it did not. */
function endedAt(booking: Ended): Date | null {
  if (booking.source !== "website") return null;
  if (booking.status === "cancelled") return booking.declinedAt;
  if (booking.status === "expired") return booking.expiredAt;
  return null;
}

/** Anonymises the guests whose requests have all come to nothing long enough ago. */
export async function anonymiseOldRequests(now = new Date()): Promise<number> {
  const candidates = await db.booking.findMany({
    where: {
      source: "website",
      guest: { purgedAt: null },
      OR: [{ status: "cancelled", declinedAt: { not: null } }, { status: "expired" }],
    },
    select: { guestId: true, propertyId: true },
  });
  const guestIds = [...new Set(candidates.map((c) => c.guestId))];
  if (guestIds.length === 0) return 0;

  const bookings = await db.booking.findMany({
    where: { guestId: { in: guestIds } },
    select: {
      guestId: true,
      propertyId: true,
      source: true,
      status: true,
      declinedAt: true,
      expiredAt: true,
    },
  });
  const settings = await getRequestSettingsFor([...new Set(bookings.map((b) => b.propertyId))]);
  const old = (booking: Ended) => {
    const ended = endedAt(booking);
    const months = (settings.get(booking.propertyId) ?? DEFAULT_REQUEST_SETTINGS).retentionMonths;
    return ended !== null && ended <= monthsBefore(now, months);
  };

  let purged = 0;
  for (const guestId of guestIds) {
    const theirs = bookings.filter((b) => b.guestId === guestId);
    if (theirs.length > 0 && theirs.every(old)) {
      const result = await purgeGuest(guestId, null);
      if (result.outcome === "anonymised" || result.outcome === "deleted") purged++;
    }
  }
  return purged;
}
