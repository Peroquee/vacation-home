/**
 * Block queries. Server-side only. Availability (GitLab #52) combines these
 * with confirmed bookings; the date rule is the half-open one documented on
 * the Block model and in src/lib/date-range.ts.
 */
import type { Block } from "@/generated/prisma/client";
import { type CalendarDate, toUtcDate } from "@/lib/calendar-date";
import { assertNonEmptyRange } from "@/lib/date-range";
import { db, type DbClient } from "@/lib/db";

/**
 * Blocks on `propertyId` that share at least one night with `[start, end)`,
 * by start date. A block ending on `start`, or starting on `end`, does not
 * count. Throws for an empty or inverted range rather than reporting it free.
 *
 * Checking and then writing is only safe if concurrent writers are kept
 * out: call this inside the transaction that writes the booking, after
 * locking the property row (`SELECT ... FOR UPDATE`), and lock it as well
 * when writing blocks. The availability service (GitLab #52) does both.
 */
export async function findOverlappingBlocks(
  propertyId: string,
  { start, end }: { start: CalendarDate; end: CalendarDate },
  client: DbClient = db,
): Promise<Block[]> {
  assertNonEmptyRange({ start, end });
  return client.block.findMany({
    where: {
      propertyId,
      startDate: { lt: toUtcDate(end) },
      endDate: { gt: toUtcDate(start) },
    },
    orderBy: { startDate: "asc" },
  });
}
