/**
 * The sync status surface (GitLab #75): per-booking badges, the list of
 * recent failures with a manual retry, and dead letters. Server-side only.
 *
 * Errors are only ever shown as the fixed sentences of ./sync-summary.ts,
 * chosen by the stored error kind - never Google's own text.
 */
import { z } from "zod";

import type { CalendarSyncState } from "@/generated/prisma/client";
import { fromUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

import { errorMessage } from "./sync-summary";

export type BookingSyncState = "synced" | "pending" | "failed" | "dead" | "not_synced";

/** Worst first: a booking shows its most urgent link. */
const URGENCY: BookingSyncState[] = ["dead", "failed", "pending", "synced"];
const asBookingState = (state: CalendarSyncState): BookingSyncState =>
  state === "pending_delete" ? "pending" : state;

export const bookingIdsSchema = z.object({
  ids: z
    .string()
    .transform((value) => [
      ...new Set(
        value
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ])
    .pipe(
      z.array(z.uuid("must be booking ids")).min(1, "is required").max(200, "at most 200 at once"),
    ),
});

/** The sync badge of each booking: `not_synced` when it has no event (sync off, or not confirmed). */
export async function bookingSyncStatus(bookingIds: string[]) {
  const links = await db.calendarEventLink.findMany({ where: { bookingId: { in: bookingIds } } });
  const status: Record<
    string,
    { state: BookingSyncState; lastSyncedAt: string | null; error: string | null }
  > = {};
  for (const id of bookingIds) {
    const own = links.filter((l) => l.bookingId === id);
    if (own.length === 0) {
      status[id] = { state: "not_synced", lastSyncedAt: null, error: null };
      continue;
    }
    const worst = own.reduce((a, b) =>
      URGENCY.indexOf(asBookingState(a.syncState)) <= URGENCY.indexOf(asBookingState(b.syncState))
        ? a
        : b,
    );
    const synced = own.map((l) => l.lastSyncedAt).filter((d): d is Date => d !== null);
    const state = asBookingState(worst.syncState);
    status[id] = {
      state,
      lastSyncedAt: synced.length ? new Date(Math.max(...synced.map(Number))).toISOString() : null,
      error: state === "failed" || state === "dead" ? errorMessage(worst.lastError) : null,
    };
  }
  return status;
}

const FAILING: CalendarSyncState[] = ["failed", "dead"];

/** The user's failing booking events, most recently failed first. */
export async function recentFailures(userId: string, limit = 50) {
  const links = await db.calendarEventLink.findMany({
    where: {
      userId,
      OR: [
        { syncState: { in: FAILING } },
        { syncState: "pending_delete", lastError: { not: null } },
      ],
    },
    include: { booking: { include: { property: { select: { id: true, name: true } } } } },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  return links.map((link) => ({
    linkId: link.id,
    state: link.syncState === "pending_delete" ? ("delete_failing" as const) : link.syncState,
    error: errorMessage(link.lastError),
    attempts: link.attempts,
    failingSince: link.failingSince?.toISOString() ?? null,
    /** Null for a dead letter: only a manual retry tries again. */
    nextAttemptAt: link.syncState === "dead" ? null : link.nextAttemptAt.toISOString(),
    booking: link.booking && {
      id: link.booking.id,
      checkIn: fromUtcDate(link.booking.checkIn),
      checkOut: fromUtcDate(link.booking.checkOut),
      property: link.booking.property,
    },
  }));
}

const retryNow = { attempts: 0, nextAttemptAt: new Date(0), claimedUntil: null };

/**
 * Retries failing events of the user now: one link, or all of them. Failed
 * and dead pushes become pending again; failing deletes stay deletes.
 * Returns how many were queued.
 */
export async function retry(userId: string, linkId?: string): Promise<number> {
  const scope = { userId, ...(linkId && { id: linkId }) };
  const [pushes, deletes] = await db.$transaction([
    db.calendarEventLink.updateMany({
      where: { ...scope, syncState: { in: FAILING } },
      data: { ...retryNow, nextAttemptAt: new Date(), syncState: "pending" },
    }),
    db.calendarEventLink.updateMany({
      where: { ...scope, syncState: "pending_delete", lastError: { not: null } },
      data: { ...retryNow, nextAttemptAt: new Date() },
    }),
  ]);
  return pushes.count + deletes.count;
}
