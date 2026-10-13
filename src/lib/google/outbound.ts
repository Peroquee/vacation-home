/**
 * Outbound sync: bookings pushed to their property's Google Calendar as
 * all-day events (GitLab #70). Server-side only.
 *
 * - **Scheduling** happens in the booking write's own transaction
 *   (`scheduleBookingSync`): it marks the booking's link due and bumps its
 *   `changeSeq`. No change can be lost to a crash, and rapid edits collapse
 *   into one push of the latest version.
 * - **Processing** (`processDueLinks`, run by ./sync-worker.ts) claims due
 *   links with a lease, pushes or deletes their events through the retrying
 *   API client (./calendar.ts), and records the outcome with a backoff on
 *   failure. Each booking has one link per calendar and the event id is
 *   fixed before the first insert, so retries and repeats never create a
 *   second event.
 * - **Only confirmed bookings** have an event. Cancelling a booking, or
 *   turning it back into an inquiry, deletes its event.
 * - **No guest personal data** reaches Google: the event says "Booking ·
 *   <property>", with the booking's id, nights, guest count and total. A
 *   guest erasure (DSGVO) therefore never has to reach Google.
 * - **Turning sync off** (no PropertyCalendar, or `outbound: false`) or a
 *   disconnected Google account stops all pushes; events already in Google
 *   are left as they are.
 */
import { holdsDates } from "@/lib/bookings/values";
import { env } from "@/env";
import type { BookingStatus, CalendarEventLink } from "@/generated/prisma/client";
import {
  addDays,
  type CalendarDate,
  daysBetween,
  fromUtcDate,
  toUtcDate,
} from "@/lib/calendar-date";
import { db, type DbClient } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import type { Logger } from "@/lib/logger";
import { logger as rootLogger } from "@/lib/logger";

import { type CalendarClient, createCalendarClient, type EventInput } from "./calendar";
import { getConnectionStatus } from "./connection";
import { deleteRemoteEvent, ensureLink, errorKind, pushEvent } from "./links";

/** The private extended property that marks the app's own events in Google. */
export const APP_EVENT_MARKER = "vacationHome";

/** A worker's lease on a claimed link: long enough for a call with all its retries. */
const LEASE_MS = 5 * 60_000;
/** How long to wait before looking again at a link that cannot be synced now. */
const DEFER_MS = 15 * 60_000;

export type BookingForEvent = {
  id: string;
  checkIn: CalendarDate;
  checkOut: CalendarDate;
  guestCount: number;
  totalAmountMinor: number;
  currency: string;
};

/**
 * The Google event for a booking: all-day, from check-in to check-out
 * (Google's all-day end date is exclusive, like check-out). Deliberately
 * free of guest personal data - no name, email, phone or notes.
 */
export function bookingEvent(
  booking: BookingForEvent,
  property: { name: string },
): Omit<EventInput, "id"> {
  const nights = daysBetween(booking.checkIn, booking.checkOut);
  const guests = `${booking.guestCount} guest${booking.guestCount === 1 ? "" : "s"}`;
  const description = [
    `Booking ${booking.id}`,
    `${nights} night${nights === 1 ? "" : "s"}, ${guests}`,
    // The event text is English, so is its amount.
    `Total: ${formatMoney(booking.totalAmountMinor, booking.currency, { locale: "en-GB" })}`,
    "",
    `Open in Vacation Home: ${new URL(`/bookings/${booking.id}`, env.APP_URL)}`,
    "Kept in sync by Vacation Home: change the booking in the app, not here.",
  ].join("\n");
  return {
    summary: `Booking · ${property.name}`,
    description,
    start: { date: booking.checkIn },
    end: { date: booking.checkOut },
    transparency: "opaque",
    extendedProperties: { private: { [APP_EVENT_MARKER]: "booking", bookingId: booking.id } },
  };
}

const due = () => ({ nextAttemptAt: new Date(), attempts: 0, changeSeq: { increment: 1 } });

/**
 * Marks a booking's event as needing a push (or a delete), in `client`'s
 * transaction. Does nothing while the property has no calendar or outbound
 * sync is off. Call after every booking write; `kickOutboundSync` after the
 * commit makes it happen at once.
 */
export async function scheduleBookingSync(bookingId: string, client: DbClient = db): Promise<void> {
  const booking = await client.booking.findUnique({
    where: { id: bookingId },
    select: { status: true, property: { select: { calendar: true } } },
  });
  const config = booking?.property.calendar;
  if (!booking || !config?.outbound) return;

  const links = await client.calendarEventLink.findMany({ where: { bookingId } });
  // Events in a calendar the property no longer uses go; a booking that does
  // not hold its dates has none.
  for (const link of links) {
    if (link.calendarId === config.calendarId && hasEvent(booking.status)) continue;
    await client.calendarEventLink.update({
      where: { id: link.id },
      data: { syncState: "pending_delete", ...due() },
    });
  }
  if (!hasEvent(booking.status)) return;

  const link = await ensureLink({ bookingId }, config.calendarId, client, config.userId);
  await client.calendarEventLink.update({
    where: { id: link.id },
    data: { syncState: "pending", ...due() },
  });
}

/** Bookings holding their dates are in the owner's calendar; a reservation too. */
const hasEvent = (status: BookingStatus) => holdsDates(status);

/**
 * Schedules every booking of a property that is current or still to come
 * (checking out at most 30 days ago): after choosing a calendar, or for
 * "resync everything".
 */
export async function scheduleProperty(propertyId: string, now = new Date()): Promise<number> {
  const since = toUtcDate(addDays(now.toISOString().slice(0, 10), -30));
  const bookings = await db.booking.findMany({
    where: { propertyId, checkOut: { gte: since } },
    select: { id: true },
  });
  for (const { id } of bookings) {
    await db.$transaction((tx) => scheduleBookingSync(id, tx));
  }
  return bookings.length;
}

/** Whether any link is due now: lets the worker stay quiet when idle. */
export async function hasDueLinks(now = new Date()): Promise<boolean> {
  const link = await db.calendarEventLink.findFirst({
    where: {
      syncState: { in: ["pending", "failed", "pending_delete"] },
      nextAttemptAt: { lte: now },
      OR: [{ claimedUntil: null }, { claimedUntil: { lt: now } }],
    },
    select: { id: true },
  });
  return link !== null;
}

/**
 * Claims up to `limit` due links for this worker. SKIP LOCKED and the lease
 * keep two workers - another process, or a run overlapping a slow one - off
 * the same link.
 */
async function claimDueLinks(now: Date, limit: number): Promise<CalendarEventLink[]> {
  const until = new Date(now.getTime() + LEASE_MS);
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE calendar_event_links SET claimed_until = ${until}
    WHERE id IN (
      SELECT id FROM calendar_event_links
      WHERE sync_state IN ('pending', 'failed', 'pending_delete')
        AND next_attempt_at <= ${now}
        AND (claimed_until IS NULL OR claimed_until < ${now})
      ORDER BY next_attempt_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return db.calendarEventLink.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    orderBy: { nextAttemptAt: "asc" },
  });
}

/** Puts a link aside for a while without counting a failed attempt. */
async function defer(link: CalendarEventLink, reason: string, now: Date) {
  await db.calendarEventLink.updateMany({
    where: { id: link.id, changeSeq: link.changeSeq },
    data: {
      lastError: reason,
      claimedUntil: null,
      nextAttemptAt: new Date(now.getTime() + DEFER_MS),
    },
  });
  await db.calendarEventLink.updateMany({
    where: { id: link.id, changeSeq: { not: link.changeSeq } },
    data: { claimedUntil: null },
  });
}

export type SyncRun = { pushed: number; deleted: number; failed: number; deferred: number };

export type ProcessOptions = {
  now?: () => Date;
  /** Links per claim. */
  limit?: number;
  calendarFor?: (userId: string, log: Logger) => CalendarClient;
  log?: Logger;
};

/**
 * Pushes or deletes the events of every due link, in batches, until none is
 * due. Failures are recorded on the link (with a backoff) and counted, never
 * thrown: one bad booking or a Google outage cannot stop the others.
 */
export async function processDueLinks(options: ProcessOptions = {}): Promise<SyncRun> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? rootLogger;
  const calendarFor =
    options.calendarFor ?? ((userId: string, log: Logger) => createCalendarClient({ userId, log }));
  const run: SyncRun = { pushed: 0, deleted: 0, failed: 0, deferred: 0 };
  const calendars = new Map<string, CalendarClient>();
  const connected = new Map<string, boolean>();

  for (;;) {
    const links = await claimDueLinks(now(), options.limit ?? 20);
    if (links.length === 0) return run;
    for (const link of links) {
      const outcome = await processLink(link);
      run[outcome]++;
    }
  }

  async function processLink(link: CalendarEventLink): Promise<keyof SyncRun> {
    const ids = { linkId: link.id, bookingId: link.bookingId, calendarId: link.calendarId };
    const userId = link.userId;
    if (!userId) {
      await defer(link, "not_connected", now());
      return "deferred";
    }
    if (!connected.has(userId)) {
      connected.set(userId, (await getConnectionStatus(userId)).status === "connected");
    }
    if (!connected.get(userId)) {
      // Disconnected or revoked: nothing can be written until reconnected.
      await defer(link, "not_connected", now());
      return "deferred";
    }
    let calendar = calendars.get(userId);
    if (!calendar) calendars.set(userId, (calendar = calendarFor(userId, log)));

    try {
      if (link.syncState === "pending_delete") {
        await deleteRemoteEvent(link, calendar);
        log.info(ids, "google event deleted");
        return "deleted";
      }

      const booking = link.bookingId
        ? await db.booking.findUnique({
            where: { id: link.bookingId },
            include: { property: { select: { name: true, calendar: true } } },
          })
        : null;
      const config = booking?.property.calendar;
      if (!booking || !config?.outbound || config.calendarId !== link.calendarId) {
        // Sync turned off, or the property moved to another calendar: left
        // alone until scheduled again.
        await defer(link, "sync_off", now());
        return "deferred";
      }
      if (!hasEvent(booking.status)) {
        // Cancelled after it was scheduled; scheduling has (or will have)
        // marked it for deletion.
        await defer(link, "not_confirmed", now());
        return "deferred";
      }

      const event = bookingEvent(
        {
          id: booking.id,
          checkIn: fromUtcDate(booking.checkIn),
          checkOut: fromUtcDate(booking.checkOut),
          guestCount: booking.guestCount,
          totalAmountMinor: booking.totalAmountMinor,
          currency: booking.currency,
        },
        booking.property,
      );
      await pushEvent(link, event, calendar);
      log.info(ids, "google event pushed");
      return "pushed";
    } catch (error) {
      // Already recorded on the link, with its backoff.
      if (errorKind(error) === "not_connected") connected.set(userId, false);
      log.warn({ ...ids, kind: errorKind(error) }, "google event sync failed; will retry");
      return "failed";
    }
  }
}
