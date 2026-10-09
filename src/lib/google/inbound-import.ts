/**
 * Inbound sync, part two (GitLab #73): events found in a property's Google
 * Calendar (./inbound.ts) become read-only blocks, `origin: google` - never
 * bookings. Server-side only.
 *
 * - **Echoes are skipped**: events carrying the app's private extended
 *   property are the app's own bookings coming back (./outbound.ts), so a
 *   booking never turns into a block of itself.
 * - **What blocks**: all-day events, on their own dates (Google's all-day end
 *   date is exclusive, like a block's). Timed events lasting at least
 *   GOOGLE_IMPORT_MIN_TIMED_HOURS (default 12) block every night they touch,
 *   in the property's timezone; shorter ones - meetings - and events marked
 *   "free" (transparent) do not.
 * - **Deletion**: a cancelled event, or with a full list one that is no
 *   longer there, removes its block. An event that stops qualifying (made
 *   "free", shortened) does too.
 * - **No personal data**: a block stores the Google event id and its dates,
 *   and names its source ("Google Calendar · <calendar>"). The event's
 *   title, description, location and attendees are never stored.
 * - **Conflicts**: a block may not overlap a confirmed booking (the database
 *   refuses it). Such an event is not imported; it is logged here, and
 *   GitLab #74 raises it for review.
 *
 * All writes for one batch happen under the property's lock, like every
 * other block or booking write.
 */
import { env } from "@/env";
import { invalidateWindows } from "@/lib/availability/cache";
import { isOverlapViolation, withPropertyLock } from "@/lib/availability/service";
import { addDays, type CalendarDate, fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import { type DateRange } from "@/lib/date-range";
import type { DbClient } from "@/lib/db";
import { logger } from "@/lib/logger";

import type { CalendarEvent } from "./calendar";
import type { InboundBatch } from "./inbound";
import { APP_EVENT_MARKER } from "./outbound";
import { kickOutboundSync } from "./sync-worker";

/** The local calendar date of an instant in `timezone`. */
function localDate(instant: string, timezone: string): CalendarDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(instant));
}

/**
 * The nights an event blocks, or null if it should not block anything:
 * the app's own events, free time, and timed events shorter than the
 * threshold.
 */
export function blockedNights(
  event: CalendarEvent,
  timezone: string,
  minTimedHours = env.GOOGLE_IMPORT_MIN_TIMED_HOURS,
): DateRange | null {
  if (event.status === "cancelled") return null;
  if (event.extendedProperties?.private?.[APP_EVENT_MARKER]) return null;
  if (event.transparency === "transparent") return null;

  if (event.start.date && event.end.date) {
    return event.end.date > event.start.date
      ? { start: event.start.date, end: event.end.date }
      : null;
  }
  if (!event.start.dateTime || !event.end.dateTime) return null;
  const hours =
    (new Date(event.end.dateTime).getTime() - new Date(event.start.dateTime).getTime()) / 3_600_000;
  if (hours < minTimedHours) return null;
  // Every night touched: from the night it starts on, up to the day it ends
  // (an event ending at 11:00 leaves that night free) - at least one night.
  const start = localDate(event.start.dateTime, timezone);
  const endDay = localDate(event.end.dateTime, timezone);
  return { start, end: endDay > start ? endDay : addDays(start, 1) };
}

export type ImportResult = {
  created: number;
  updated: number;
  deleted: number;
  /** Events not imported because they overlap a confirmed booking (each an open issue). */
  conflicts: string[];
  /** App events edited or deleted in Google, queued to be written back. */
  repushed: number;
};

/** Applies a batch of Google changes to the property's `google` blocks. */
export async function importInboundEvents(batch: InboundBatch): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, deleted: 0, conflicts: [], repushed: 0 };
  const touched: DateRange[] = [];

  await withPropertyLock(batch.propertyId, async (tx) => {
    const property = await tx.property.findUniqueOrThrow({
      where: { id: batch.propertyId },
      select: { timezone: true, calendar: { select: { calendarName: true } } },
    });
    const reason = `Google Calendar · ${property.calendar?.calendarName ?? "calendar"}`;
    const existing = await tx.block.findMany({
      where: { propertyId: batch.propertyId, origin: "google" },
    });
    const byEvent = new Map(existing.map((b) => [b.externalEventId, b]));

    for (const event of batch.events) {
      if (event.extendedProperties?.private?.[APP_EVENT_MARKER]) {
        if (await repushIfChanged(tx, batch.calendarId, event)) result.repushed++;
        continue;
      }
      const nights = blockedNights(event, property.timezone);
      const block = byEvent.get(event.id);
      if (!nights) {
        if (block) {
          await tx.block.delete({ where: { id: block.id } });
          touched.push(span(block));
          result.deleted++;
        }
        continue;
      }
      if (
        block &&
        fromUtcDate(block.startDate) === nights.start &&
        fromUtcDate(block.endDate) === nights.end
      ) {
        continue;
      }
      const written = await writeBlock(tx, batch.propertyId, event.id, nights, reason, block?.id);
      if (!written) {
        await raiseOverlapIssue(tx, batch, event.id, nights);
        result.conflicts.push(event.id);
        continue;
      }
      touched.push(nights);
      if (block) {
        touched.push(span(block));
        result.updated++;
      } else {
        result.created++;
      }
    }

    // Overlap issues whose event no longer conflicts - moved, deleted, no
    // longer blocking, or no longer in a full list - resolve themselves.
    const conflicted = new Set(result.conflicts);
    const listed = batch.events.map((e) => e.id).filter((id) => !conflicted.has(id));
    await tx.calendarSyncIssue.updateMany({
      where: {
        propertyId: batch.propertyId,
        kind: "inbound_overlap",
        resolvedAt: null,
        ...(batch.full
          ? { googleEventId: { notIn: [...conflicted] } }
          : { googleEventId: { in: listed } }),
      },
      data: { resolvedAt: new Date(), resolution: "gone" },
    });

    // A full list is the whole truth: blocks of events no longer in it go.
    if (batch.full) {
      const present = new Set(batch.events.map((e) => e.id));
      const gone = existing.filter((b) => !present.has(b.externalEventId!));
      if (gone.length > 0) {
        await tx.block.deleteMany({ where: { id: { in: gone.map((b) => b.id) } } });
        touched.push(...gone.map(span));
        result.deleted += gone.length;
      }
    }
  });

  if (touched.length > 0) invalidateWindows(batch.propertyId, touched);
  if (result.repushed > 0) kickOutboundSync();
  if (result.conflicts.length > 0) {
    logger.warn(
      { propertyId: batch.propertyId, events: result.conflicts.length },
      "google events overlapping confirmed bookings were not imported",
    );
  }
  return result;
}

/**
 * An app event that comes back changed - edited in Google, or deleted there
 * - is queued to be written again: the booking wins. Compared by etag: the
 * app's own write comes back with the etag it stored, so it causes nothing,
 * and the two sides cannot keep updating each other.
 */
async function repushIfChanged(tx: DbClient, calendarId: string, event: CalendarEvent) {
  const link = await tx.calendarEventLink.findUnique({
    where: { calendarId_googleEventId: { calendarId, googleEventId: event.id } },
  });
  if (!link || link.syncState !== "synced" || link.etag === event.etag) return false;
  await tx.calendarEventLink.update({
    where: { id: link.id },
    data: {
      syncState: "pending",
      changeSeq: { increment: 1 },
      attempts: 0,
      nextAttemptAt: new Date(),
    },
  });
  logger.info(
    { linkId: link.id, bookingId: link.bookingId, deletedInGoogle: event.status === "cancelled" },
    "app event changed in Google; writing the booking's version back",
  );
  return true;
}

/** Opens (or refreshes) the review issue for an event that overlaps confirmed bookings. */
async function raiseOverlapIssue(
  tx: DbClient,
  batch: InboundBatch,
  eventId: string,
  nights: DateRange,
) {
  const bookings = await tx.booking.findMany({
    where: {
      propertyId: batch.propertyId,
      status: "confirmed",
      checkIn: { lt: toUtcDate(nights.end) },
      checkOut: { gt: toUtcDate(nights.start) },
    },
    select: { id: true },
    orderBy: { checkIn: "asc" },
  });
  const facts = {
    calendarId: batch.calendarId,
    bookingIds: bookings.map((b) => b.id),
    startDate: toUtcDate(nights.start),
    endDate: toUtcDate(nights.end),
  };
  const open = await tx.calendarSyncIssue.findFirst({
    where: {
      propertyId: batch.propertyId,
      googleEventId: eventId,
      kind: "inbound_overlap",
      resolvedAt: null,
    },
  });
  if (open) {
    await tx.calendarSyncIssue.update({ where: { id: open.id }, data: facts });
  } else {
    await tx.calendarSyncIssue.create({
      data: {
        propertyId: batch.propertyId,
        googleEventId: eventId,
        kind: "inbound_overlap",
        ...facts,
      },
    });
  }
}

const span = (block: { startDate: Date; endDate: Date }): DateRange => ({
  start: fromUtcDate(block.startDate),
  end: fromUtcDate(block.endDate),
});

/**
 * Creates or moves a block, inside a savepoint so that the database's
 * overlap refusal (a confirmed booking there) skips only this event.
 * Returns false when refused.
 */
async function writeBlock(
  tx: DbClient,
  propertyId: string,
  eventId: string,
  nights: DateRange,
  reason: string,
  blockId: string | undefined,
): Promise<boolean> {
  const dates = { startDate: toUtcDate(nights.start), endDate: toUtcDate(nights.end) };
  await tx.$executeRawUnsafe("SAVEPOINT import_block");
  try {
    if (blockId) {
      await tx.block.update({ where: { id: blockId }, data: { ...dates, reason } });
    } else {
      await tx.block.create({
        data: { propertyId, origin: "google", externalEventId: eventId, reason, ...dates },
      });
    }
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT import_block");
    return true;
  } catch (error) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT import_block");
    if (isOverlapViolation(error)) return false;
    throw error;
  }
}
