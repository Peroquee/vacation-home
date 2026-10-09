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
 * - **Conflicts**: like Google's blocks, an event may not overlap a confirmed
 *   booking (the database refuses it). It is skipped and counted on the feed
 *   (`conflictCount`), so settings can say so; the booking wins.
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
import { FeedParseError, type FeedEvent, parseFeed } from "./parse";

/** Stays that ended longer ago than this are not imported. */
const HISTORY_DAYS = 365;

export type FeedImport =
  | { kind: "unchanged" }
  | { kind: "failed"; code: string }
  | { kind: "imported"; created: number; updated: number; deleted: number; conflicts: number };

const externalId = (feedId: string, uid: string) => `${feedId}:${uid}`;

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

  const fetched = await fetchFeed(feed.url, feed, fetcher);
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

  let events: FeedEvent[];
  try {
    events = parseFeed(fetched.text, feed.property.timezone);
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
  const wanted = events.filter((e) => e.end > oldest);
  const result = { created: 0, updated: 0, deleted: 0, conflicts: 0 };
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

    // Current blocks whose stay is no longer in the feed: cancelled there.
    const present = new Set(wanted.map((e) => externalId(feed.id, e.uid)));
    const gone = existing.filter(
      (b) => !present.has(b.externalEventId!) && fromUtcDate(b.endDate) > today,
    );
    if (gone.length > 0) {
      await tx.block.deleteMany({ where: { id: { in: gone.map((b) => b.id) } } });
      touched.push(...gone.map(span));
      result.deleted += gone.length;
    }

    await tx.icalFeed.update({
      where: { id: feed.id },
      data: {
        lastFetchedAt: now,
        lastSuccessAt: now,
        nextFetchAt: next,
        lastError: null,
        eventCount: wanted.length,
        conflictCount: result.conflicts,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
      },
    });
  });

  if (touched.length > 0) invalidateWindows(feed.propertyId, touched);
  if (result.conflicts > 0) {
    logger.warn(
      { feedId: feed.id, events: result.conflicts },
      "ical events overlapping confirmed bookings were not imported",
    );
  }
  return { kind: "imported", ...result };
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
      const outcome = await importFeed(id, { now });
      if (outcome?.kind === "failed") run.failed++;
      else run.fetched++;
    } catch (err) {
      run.failed++;
      logger.error({ err, feedId: id }, "ical feed import failed");
    }
  }
  return run;
}
