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
import { logger } from "@/lib/logger";

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
  /** Whose Google connection will write the event. */
  userId?: string,
): Promise<CalendarEventLink> {
  const where = targetWhere(target, calendarId);
  const existing = await client.calendarEventLink.findUnique({ where });
  if (existing) return existing;
  try {
    return await client.calendarEventLink.create({
      data: { ...target, calendarId, googleEventId: newEventId(), userId },
    });
  } catch (error) {
    // Another sync created it first: use theirs.
    if (isPrismaError(error, "P2002")) {
      return client.calendarEventLink.findUniqueOrThrow({ where });
    }
    throw error;
  }
}

/** Delay before retrying a link after `attempts` failures in a row: 30 s doubling, at most 1 h. */
export function retryDelayMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(attempts - 1, 0), 60 * 60_000);
}

/**
 * Writes the event for a link to Google: inserted the first time, updated
 * after that. An event deleted in Google meanwhile is created afresh, under
 * a new id (Google never reuses a deleted one): the app's bookings are the
 * truth.
 *
 * Records the outcome: the etag always, and `synced` only if no newer change
 * (`changeSeq`) arrived meanwhile - otherwise the link stays due, and the
 * next run writes the newer version. A failure is recorded as `failed` with
 * the error kind (never Google's text) and a backoff, and rethrown.
 */
export async function pushEvent(
  link: CalendarEventLink,
  event: Omit<EventInput, "id">,
  calendar: CalendarClient,
): Promise<CalendarEventLink> {
  let current = link;
  try {
    let written;
    if (current.lastSyncedAt === null) {
      written = await insertOrAdopt(current, event, calendar);
    } else {
      try {
        written = await updateAppWins(current, event, calendar);
      } catch (error) {
        if (!isGone(error)) throw error;
        current = await db.calendarEventLink.update({
          where: { id: current.id },
          data: { googleEventId: newEventId(), lastSyncedAt: null, etag: null },
        });
        written = await insertOrAdopt(current, event, calendar);
      }
    }
    const done = { etag: written.etag, lastSyncedAt: new Date(), claimedUntil: null };
    // Synced, unless a newer change (`changeSeq`) arrived meanwhile or the
    // booking was cancelled (pending_delete: the event just written must
    // now go). State and lease change in one statement, so no other worker
    // can claim the link between them.
    const { count } = await db.calendarEventLink.updateMany({
      where: { id: link.id, changeSeq: link.changeSeq, syncState: { not: "pending_delete" } },
      data: { ...done, syncState: "synced", lastError: null, attempts: 0 },
    });
    // Otherwise the newer change is due again at once.
    if (count === 0) {
      await db.calendarEventLink.updateMany({ where: { id: link.id }, data: done });
    }
    return await db.calendarEventLink.findUniqueOrThrow({ where: { id: link.id } });
  } catch (error) {
    await markFailed(current, error);
    throw error;
  }
}

/** The parts of an event the app writes, compared to tell what changed in Google. */
const COMPARED = ["summary", "description", "start", "end", "transparency"] as const;

/**
 * Updates the event only if it is unchanged since the app last wrote it
 * (`If-Match` with the stored etag). If someone edited it in Google
 * meanwhile, the app's booking wins and the event is overwritten. The
 * fields where Google's version differed are logged, by name only - the
 * values may hold anything someone typed in Google.
 */
async function updateAppWins(
  link: CalendarEventLink,
  event: Omit<EventInput, "id">,
  calendar: CalendarClient,
) {
  try {
    return await calendar.updateEvent(link.calendarId, link.googleEventId, event, {
      etag: link.etag ?? undefined,
    });
  } catch (error) {
    if (!(error instanceof GoogleCalendarError && error.kind === "precondition_failed"))
      throw error;
    const remote = await calendar.getEvent(link.calendarId, link.googleEventId);
    const changed = COMPARED.filter(
      (field) => JSON.stringify(remote[field] ?? null) !== JSON.stringify(event[field] ?? null),
    );
    logger.warn(
      { linkId: link.id, bookingId: link.bookingId, differingFields: changed },
      "google event was edited in Google; the booking wins and overwrites it",
    );
    return calendar.updateEvent(link.calendarId, link.googleEventId, event);
  }
}

const isGone = (error: unknown) =>
  error instanceof GoogleCalendarError && (error.kind === "not_found" || error.kind === "gone");

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
 * Deletes the Google event of a `pending_delete` link, then the link. An
 * event already deleted in Google counts as done. If the booking was
 * re-confirmed meanwhile (a newer change), the link stays, under a fresh
 * event id, so the next run creates the event again.
 */
export async function deleteRemoteEvent(
  link: CalendarEventLink,
  calendar: CalendarClient,
): Promise<void> {
  try {
    await calendar.deleteEvent(link.calendarId, link.googleEventId);
  } catch (error) {
    await markFailed(link, error);
    throw error;
  }
  const { count } = await db.calendarEventLink.deleteMany({
    where: { id: link.id, changeSeq: link.changeSeq },
  });
  if (count === 0) {
    await db.calendarEventLink.updateMany({
      where: { id: link.id },
      data: { googleEventId: newEventId(), lastSyncedAt: null, etag: null, claimedUntil: null },
    });
  }
}

/** Links whose Google event still has to be deleted. */
export function pendingDeletes(client: DbClient = db): Promise<CalendarEventLink[]> {
  return client.calendarEventLink.findMany({
    where: { syncState: "pending_delete" },
    orderBy: { updatedAt: "asc" },
  });
}

/** The data-free name of what went wrong. */
export function errorKind(error: unknown): string {
  return error instanceof GoogleCalendarError
    ? error.kind
    : error instanceof CalendarNotConnectedError
      ? "not_connected"
      : "unexpected_error";
}

async function markFailed(link: CalendarEventLink, error: unknown): Promise<void> {
  const attempts = link.attempts + 1;
  const retry = {
    lastError: errorKind(error),
    attempts,
    nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)),
    claimedUntil: null,
  };
  // A link waiting for its remote delete stays pending_delete: that is what
  // remains to be done, and a booking-less link must not be anything else.
  // A newer change that arrived meanwhile is not held back by the backoff.
  const same = { id: link.id, changeSeq: link.changeSeq };
  await db.calendarEventLink.updateMany({
    where: { ...same, syncState: { not: "pending_delete" } },
    data: { syncState: "failed", ...retry },
  });
  await db.calendarEventLink.updateMany({
    where: { ...same, syncState: "pending_delete" },
    data: retry,
  });
  await db.calendarEventLink.updateMany({
    where: { id: link.id, changeSeq: { not: link.changeSeq } },
    data: { lastError: retry.lastError, claimedUntil: null },
  });
}
