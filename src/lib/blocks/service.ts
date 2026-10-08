/**
 * Block queries. Server-side only. Availability (GitLab #52) combines these
 * with confirmed bookings; the date rule is the half-open one documented on
 * the Block model and in src/lib/date-range.ts.
 */
import type { Block, Prisma } from "@/generated/prisma/client";
import { type CalendarDate, toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

/** `db` itself, or the client inside a `db.$transaction`. */
export type DbClient = Prisma.TransactionClient | typeof db;

/**
 * Blocks on `propertyId` that share at least one night with `[start, end)`,
 * by start date. A block ending on `start`, or starting on `end`, does not
 * count. Pass a transaction client to check inside the transaction that will
 * write the booking.
 */
export async function findOverlappingBlocks(
  propertyId: string,
  { start, end }: { start: CalendarDate; end: CalendarDate },
  client: DbClient = db,
): Promise<Block[]> {
  return client.block.findMany({
    where: {
      propertyId,
      startDate: { lt: toUtcDate(end) },
      endDate: { gt: toUtcDate(start) },
    },
    orderBy: { startDate: "asc" },
  });
}
