/**
 * Booking-to-event links (`calendar_event_links`): which Google event stands
 * for which booking or manual block, so sync is idempotent. Server-side only.
 *
 * The Google event id is chosen here, before the first insert, and stored
 * with the link. A retried insert therefore reuses it (and the client
 * recognises the event it already created), and a re-run for a synced
 * booking updates that event instead of creating another.
 */
import type { CalendarEventLink } from "@/generated/prisma/client";
import { db, type DbClient } from "@/lib/db";
import { isPrismaError } from "@/lib/db-errors";

import type { CalendarClient, EventInput } from "./calendar";
import { GoogleCalendarError } from "./calendar";
import { CalendarNotConnectedError } from "./connection";

export type LinkTarget = { bookingId: string } | { blockId: string };

/**
 * A Google event id for a new link: "vh" and 32 hex digits. Hex digits are
 * within Google's base32hex alphabet (a-v, 0-9), and the prefix makes the
 * app's events easy to tell apart.
 */
export function newEventId(): string {
  return `vh${crypto.randomUUID().replaceAll("-", "")}`;
}

function targetWhere(target: LinkTarget, calendarId: string) {
  return "bookingId" in target
    ? { bookingId_calendarId: { bookingId: target.bookingId, calendarId } }
    : { blockId_calendarId: { blockId: target.blockId, calendarId } };
}

/** The target's link to `calendarId`, created (as `pending`) if there is none. */
export async function ensureLink(
  target: LinkTarget,
  calendarId: string,
  client: DbClient = db,
): Promise<CalendarEventLink> {
  const where = targetWhere(target, calendarId);
  const existing = await client.calendarEventLink.findUnique({ where });
  if (existing) return existing;
  try {
    return await client.calendarEventLink.create({
      data: { ...target, calendarId, googleEventId: newEventId() },
    });
  } catch (error) {
    // Another sync created it first: use theirs.
    if (isPrismaError(error, "P2002")) {
      return client.calendarEventLink.findUniqueOrThrow({ where });
    }
    throw error;
  }
}

/**
 * Writes the event for a link to Google: inserted the first time, updated
 * after that. Records the outcome on the link - `synced` with Google's etag,
 * or `failed` with the error kind (never Google's text) - and rethrows a
 * failure so the job can decide whether to retry.
 */
export async function pushEvent(
  link: CalendarEventLink,
  event: Omit<EventInput, "id">,
  calendar: CalendarClient,
): Promise<CalendarEventLink> {
  try {
    const written =
      link.lastSyncedAt === null
        ? await insertOrAdopt(link, event, calendar)
        : await calendar.updateEvent(link.calendarId, link.googleEventId, event);
    // Not over a pending_delete: the booking was deleted meanwhile, and the
    // event just written must now go.
    await db.calendarEventLink.updateMany({
      where: { id: link.id, syncState: { not: "pending_delete" } },
      data: { syncState: "synced", etag: written.etag, lastSyncedAt: new Date(), lastError: null },
    });
    return await db.calendarEventLink.findUniqueOrThrow({ where: { id: link.id } });
  } catch (error) {
    await markFailed(link.id, error);
    throw error;
  }
}

/**
 * Inserts the link's event. If it already exists - an earlier run created
 * it but did not get to record that - the id is this link's alone, so the
 * event is ours: update it instead.
 */
async function insertOrAdopt(
  link: CalendarEventLink,
  event: Omit<EventInput, "id">,
  calendar: CalendarClient,
) {
  try {
    return await calendar.insertEvent(link.calendarId, { ...event, id: link.googleEventId });
  } catch (error) {
    if (!(error instanceof GoogleCalendarError) || error.kind !== "conflict") throw error;
    return calendar.updateEvent(link.calendarId, link.googleEventId, event);
  }
}

/**
 * Deletes the Google event of a link whose booking or block is gone, then
 * the link itself. An event already deleted in Google counts as done.
 */
export async function deleteRemoteEvent(
  link: CalendarEventLink,
  calendar: CalendarClient,
): Promise<void> {
  try {
    await calendar.deleteEvent(link.calendarId, link.googleEventId);
  } catch (error) {
    await markFailed(link.id, error);
    throw error;
  }
  await db.calendarEventLink.deleteMany({ where: { id: link.id } });
}

/** Links whose Google event still has to be deleted. */
export function pendingDeletes(client: DbClient = db): Promise<CalendarEventLink[]> {
  return client.calendarEventLink.findMany({
    where: { syncState: "pending_delete" },
    orderBy: { updatedAt: "asc" },
  });
}

async function markFailed(linkId: string, error: unknown): Promise<void> {
  const kind =
    error instanceof GoogleCalendarError
      ? error.kind
      : error instanceof CalendarNotConnectedError
        ? "not_connected"
        : "unexpected_error";
  // A link waiting for its remote delete stays pending_delete: that is what
  // remains to be done, and a booking-less link must not be anything else.
  await db.calendarEventLink.updateMany({
    where: { id: linkId, syncState: { not: "pending_delete" } },
    data: { syncState: "failed", lastError: kind },
  });
  await db.calendarEventLink.updateMany({
    where: { id: linkId, syncState: "pending_delete" },
    data: { lastError: kind },
  });
}
