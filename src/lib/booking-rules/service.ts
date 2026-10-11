/**
 * Booking rules: storage, and the one check every caller uses (GitLab #107).
 * The public site's calendar and request API refuse what it reports; the
 * owner's booking form shows it as warnings. The rules themselves are in
 * ./rules.ts. Server-side only.
 */
import type { BookingRules as BookingRulesRow } from "@/generated/prisma/client";
import { addDays, fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import { findOverlappingBlocks } from "@/lib/blocks/service";
import { db, type DbClient } from "@/lib/db";
import { todayIn } from "@/lib/finance/recurring";

import {
  type BookingRules,
  checkStay,
  type CheckMode,
  DEFAULT_RULES,
  type RuleViolation,
  type Stay,
} from "./rules";
import type { BookingRulesInput } from "./schema";

function toRules(row: BookingRulesRow | null): BookingRules {
  if (!row) return DEFAULT_RULES;
  return {
    minNights: row.minNights,
    maxNights: row.maxNights,
    minLeadDays: row.minLeadDays,
    horizonDays: row.horizonDays,
    checkInWeekdays: row.checkInWeekdays,
    bufferDays: row.bufferDays,
  };
}

/** A property's rules; the defaults (no limits) when it has none. */
export async function getBookingRules(
  propertyId: string,
  client: DbClient = db,
): Promise<BookingRules> {
  return toRules(await client.bookingRules.findUnique({ where: { propertyId } }));
}

/** Rules for several properties at once, by property id. */
export async function getBookingRulesFor(
  propertyIds: string[],
): Promise<Map<string, BookingRules>> {
  const rows = await db.bookingRules.findMany({ where: { propertyId: { in: propertyIds } } });
  const byProperty = new Map(rows.map((row) => [row.propertyId, toRules(row)]));
  return new Map(propertyIds.map((id) => [id, byProperty.get(id) ?? DEFAULT_RULES]));
}

/** Replaces a property's rules. */
export async function saveBookingRules(
  propertyId: string,
  input: BookingRulesInput,
): Promise<BookingRules> {
  const row = await db.bookingRules.upsert({
    where: { propertyId },
    create: { propertyId, ...input },
    update: input,
  });
  return toRules(row);
}

/**
 * What `stay` breaks at `property`, judged against its rules, today in its
 * timezone, and its confirmed bookings and blocks near the stay (the
 * booking being edited, `ignoreBookingId`, left out). Empty when acceptable.
 * `mode` is "public" for the booking site (refuse) and "owner" for the
 * owner's own form (warn); see `checkStay`.
 */
export async function checkStayAt(
  property: { id: string; timezone: string },
  stay: Stay,
  {
    mode,
    ignoreBookingId,
    now = new Date(),
    client = db,
  }: { mode: CheckMode; ignoreBookingId?: string; now?: Date; client?: DbClient },
): Promise<RuleViolation[]> {
  const rules = await getBookingRules(property.id, client);
  // Near enough to matter: the buffer on either side.
  const around = {
    start: addDays(stay.checkIn, -rules.bufferDays),
    end: addDays(stay.checkOut, rules.bufferDays),
  };
  const [bookings, blocks] = await Promise.all([
    client.booking.findMany({
      where: {
        propertyId: property.id,
        status: "confirmed",
        ...(ignoreBookingId && { id: { not: ignoreBookingId } }),
        // Touching counts here: a stay ending on the day this one starts
        // leaves no free night between them.
        checkIn: { lte: toUtcDate(around.end) },
        checkOut: { gte: toUtcDate(around.start) },
      },
      select: { checkIn: true, checkOut: true },
    }),
    // Blocks touching the window too, for the same reason.
    findOverlappingBlocks(
      property.id,
      { start: addDays(around.start, -1), end: addDays(around.end, 1) },
      client,
    ),
  ]);
  const taken = [
    ...bookings.map((b) => ({ start: fromUtcDate(b.checkIn), end: fromUtcDate(b.checkOut) })),
    ...blocks.map((b) => ({ start: fromUtcDate(b.startDate), end: fromUtcDate(b.endDate) })),
  ];
  return checkStay(stay, rules, { today: todayIn(property.timezone, now), taken, mode });
}
