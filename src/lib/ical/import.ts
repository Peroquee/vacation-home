/**
 * Applies a booking platform's iCal feed (GitLab #99): its stays become
 * read-only blocks, `origin: ical`, named after the feed ("Airbnb").
 * Server-side only.
 *
 * - **Keyed by UID**: a block's `externalEventId` is `<feed id>:<UID>`, so a
 *   re-fetch moves the same block, and two feeds never collide.
 * - **Removal**: a block whose event is gone from the feed goes, but only
 *   while it is current (ends after today, where the property is). Past
 *   ones stay as history, since platforms drop old stays from their feeds.
 * - **Double bookings**: a block may not overlap a confirmed booking (the
 *   database refuses it), but a platform's stay there is real: the dates were
 *   sold twice. Such an event opens an `ical_overlap` issue (GitLab #74's
 *   review list) naming the bookings in the way, shown on the calendar, in
 *   settings and as a banner. It resolves itself once the stay is gone from
 *   the feed or no longer overlaps (it is imported as a block then).
 * - **Many at once** (GitLab #144): a fetch that would remove every current
 *   block of the feed, or more than half of them (two or more), is held
 *   back - a platform's glitch can serve an empty calendar, and would free
 *   those dates for the website. The feed shows it, and the next full fetch
 *   applies it only if it wants exactly the same removal.
 * - **Unreadable events** never remove their stay's block, and while the
 *   feed has one without a UID nothing is removed at all: there is no
 *   telling which stay it is. The feed counts them for the settings page.
 * - **Failures** leave the blocks as they were and record a code on the feed.
 *
 * Writes for one feed happen under the property's lock, like every other
 * block or booking write.
 */
import { env } from "@/env";
import { invalidateWindows } from "@/lib/availability/cache";
import { isOverlapViolation, withPropertyLock } from "@/lib/availability/service";
import { addDays, fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import type { DateRange } from "@/lib/date-range";
import { db, type DbClient } from "@/lib/db";
import { todayIn } from "@/lib/finance/recurring";
import { logger } from "@/lib/logger";

import { fetchFeed } from "./fetch";
import { type FeedEvent, FeedParseError, type FeedRead, readFeed } from "./parse";

/** Stays that ended longer ago than this are not imported. */
const HISTORY_DAYS = 365;

export type FeedImport =
  | { kind: "unchanged" }
  | { kind: "failed"; code: string }
  | {
      kind: "imported";
      created: number;
      updated: number;
      deleted: number;
      conflicts: number;
      /** Blocks the feed no longer lists but that were kept, for now. */
      held: number;
    };

const externalId = (feedId: string, uid: string) => `${feedId}:${uid}`;
const uidOf = (feedId: string, externalEventId: string) => externalEventId.slice(feedId.length + 1);

/** Whether removing `gone` of a feed's `current` blocks in one go is too much to trust. */
function tooManyAtOnce(gone: number, current: number): boolean {
  return gone > 0 && (gone === current || (gone >= 2 && gone * 2 > current));
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Fetches one feed now and applies it. Never throws for a feed's own failure. */
export async function importFeed(
  feedId: string,
  { now = new Date(), fetcher = fetch }: { now?: Date; fetcher?: typeof fetch } = {},
): Promise<FeedImport | null> {
  const feed = await db.icalFeed.findUnique({
    where: { id: feedId },
    include: { property: { select: { timezone: true } } },
  });
  if (!feed) return null;
  const next = new Date(now.getTime() + env.ICAL_POLL_MINUTES * 60_000);

  // While a double booking is open, fetch in full: the clash may be gone on
  // our side (a booking cancelled here) although the feed has not changed.
  const openIssues = await db.calendarSyncIssue.count({
    where: { feedId: feed.id, resolvedAt: null },
  });
  const validators = openIssues > 0 ? { etag: null, lastModified: null } : feed;
  const fetched = await fetchFeed(feed.url, validators, fetcher);
  if (fetched.kind !== "fetched") {
    const failed = fetched.kind === "failed";
    await db.icalFeed.update({
      where: { id: feed.id },
      data: {
        lastFetchedAt: now,
        nextFetchAt: next,
        ...(failed ? { lastError: fetched.code } : { lastError: null, lastSuccessAt: now }),
      },
    });
    if (failed) logger.warn({ feedId: feed.id, code: fetched.code }, "ical feed fetch failed");
    return failed ? { kind: "failed", code: fetched.code } : { kind: "unchanged" };
  }

  let read: FeedRead;
  try {
    read = readFeed(fetched.text, feed.property.timezone);
  } catch (error) {
    if (!(error instanceof FeedParseError)) throw error;
    await db.icalFeed.update({
      where: { id: feed.id },
      data: { lastFetchedAt: now, nextFetchAt: next, lastError: "not_ical" },
    });
    logger.warn({ feedId: feed.id }, "ical feed is not iCalendar");
    return { kind: "failed", code: "not_ical" };
  }

  const today = todayIn(feed.property.timezone, now);
  const oldest = addDays(today, -HISTORY_DAYS);
  const wanted = read.events.filter((e) => e.end > oldest);
  const result = { created: 0, updated: 0, deleted: 0, conflicts: 0, held: 0 };
  let heldRemovals: string[] = [];
  const conflicted: string[] = [];
  const touched: DateRange[] = [];

  await withPropertyLock(feed.propertyId, async (tx) => {
    const existing = await tx.block.findMany({ where: { feedId: feed.id } });
    const byId = new Map(existing.map((b) => [b.externalEventId, b]));

    for (const event of wanted) {
      const id = externalId(feed.id, event.uid);
      const block = byId.get(id);
      if (
        block &&
        fromUtcDate(block.startDate) === event.start &&
        fromUtcDate(block.endDate) === event.end &&
        block.reason === feed.name
      ) {
        continue;
      }
      const written = await writeBlock(tx, feed, id, event, block?.id);
      if (!written) {
        await raiseOverlapIssue(tx, feed, event);
        conflicted.push(event.uid);
        result.conflicts++;
        continue;
      }
      touched.push(event);
      if (block) {
        touched.push(span(block));
        result.updated++;
      } else {
        result.created++;
      }
    }

    // Current blocks whose stay is no longer in the feed: cancelled there -
    // unless the feed lists the stay in a form it couldn't read.
    const current = existing.filter((b) => fromUtcDate(b.endDate) > today);
    const present = new Set(wanted.map((e) => externalId(feed.id, e.uid)));
    const unreadable = new Set(read.unreadable.map((uid) => externalId(feed.id, uid)));
    const gone = current.filter(
      (b) => !present.has(b.externalEventId!) && !unreadable.has(b.externalEventId!),
    );
    const goneUids = gone.map((b) => uidOf(feed.id, b.externalEventId!)).sort();
    if (read.unreadableWithoutUid > 0) {
      // Any of them could be the stay of an event it can't read.
      result.held = gone.length;
    } else if (
      tooManyAtOnce(gone.length, current.length) &&
      !sameList(goneUids, feed.heldRemovals)
    ) {
      heldRemovals = goneUids;
      result.held = gone.length;
    } else if (gone.length > 0) {
      await tx.block.deleteMany({ where: { id: { in: gone.map((b) => b.id) } } });
      touched.push(...gone.map(span));
      result.deleted += gone.length;
    }

    // Double bookings whose stay is gone or imported now resolve themselves.
    await tx.calendarSyncIssue.updateMany({
      where: { feedId: feed.id, resolvedAt: null, eventUid: { notIn: conflicted } },
      data: { resolvedAt: now, resolution: "gone" },
    });

    await tx.icalFeed.update({
      where: { id: feed.id },
      data: {
        lastFetchedAt: now,
        lastSuccessAt: now,
        nextFetchAt: next,
        lastError: null,
        eventCount: wanted.length,
        conflictCount: result.conflicts,
        droppedEventCount: read.unreadable.length + read.unreadableWithoutUid,
        heldRemovals,
        heldSince: heldRemovals.length > 0 ? now : null,
        // While something is held back, the next fetch is a full one: a 304
        // could never confirm (or undo) the removal.
        etag: result.held > 0 ? null : fetched.etag,
        lastModified: result.held > 0 ? null : fetched.lastModified,
      },
    });
  });

  if (touched.length > 0) invalidateWindows(feed.propertyId, touched);
  if (result.conflicts > 0) {
    logger.warn(
      { feedId: feed.id, events: result.conflicts },
      "ical stays overlap confirmed bookings: double bookings raised for review",
    );
  }
  return { kind: "imported", ...result };
}

/** Opens (or refreshes) the double-booking issue for a stay over confirmed bookings. */
async function raiseOverlapIssue(
  tx: DbClient,
  feed: { id: string; propertyId: string },
  event: FeedEvent,
) {
  const bookings = await tx.booking.findMany({
    where: {
      propertyId: feed.propertyId,
      status: "confirmed",
      checkIn: { lt: toUtcDate(event.end) },
      checkOut: { gt: toUtcDate(event.start) },
    },
    select: { id: true },
    orderBy: { checkIn: "asc" },
  });
  const facts = {
    bookingIds: bookings.map((b) => b.id),
    startDate: toUtcDate(event.start),
    endDate: toUtcDate(event.end),
  };
  const open = await tx.calendarSyncIssue.findFirst({
    where: { feedId: feed.id, eventUid: event.uid, resolvedAt: null },
  });
  if (open) {
    await tx.calendarSyncIssue.update({ where: { id: open.id }, data: facts });
  } else {
    await tx.calendarSyncIssue.create({
      data: {
        propertyId: feed.propertyId,
        kind: "ical_overlap",
        feedId: feed.id,
        eventUid: event.uid,
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
  feed: { id: string; propertyId: string; name: string },
  externalEventId: string,
  event: DateRange,
  blockId: string | undefined,
): Promise<boolean> {
  const data = {
    startDate: toUtcDate(event.start),
    endDate: toUtcDate(event.end),
    reason: feed.name,
  };
  await tx.$executeRawUnsafe("SAVEPOINT import_ical_block");
  try {
    if (blockId) {
      await tx.block.update({ where: { id: blockId }, data });
    } else {
      await tx.block.create({
        data: {
          ...data,
          propertyId: feed.propertyId,
          origin: "ical",
          feedId: feed.id,
          externalEventId,
        },
      });
    }
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT import_ical_block");
    return true;
  } catch (error) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT import_ical_block");
    if (isOverlapViolation(error)) return false;
    throw error;
  }
}

/**
 * Feeds due for a fetch, claimed so that another run (or process) skips
 * them: the claim moves `nextFetchAt` ahead before the fetch starts.
 */
export async function importDueFeeds(
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<{ fetched: number; failed: number }> {
  const due = await db.icalFeed.findMany({
    where: { nextFetchAt: { lte: now }, property: { archivedAt: null } },
    select: { id: true, nextFetchAt: true },
    orderBy: { nextFetchAt: "asc" },
    take: 20,
  });
  const run = { fetched: 0, failed: 0 };
  for (const { id, nextFetchAt } of due) {
    const claimed = await db.icalFeed.updateMany({
      where: { id, nextFetchAt },
      data: { nextFetchAt: new Date(now.getTime() + env.ICAL_POLL_MINUTES * 60_000) },
    });
    if (claimed.count === 0) continue;
    try {
      const outcome = await importFeed(id, { now, fetcher });
      if (outcome?.kind === "failed") run.failed++;
      else run.fetched++;
    } catch (err) {
      run.failed++;
      logger.error({ err, feedId: id }, "ical feed import failed");
    }
  }
  return run;
}
