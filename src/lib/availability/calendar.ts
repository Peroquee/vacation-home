/**
 * Everything a calendar view needs for some properties over a date window, in
 * one call: their bookings and blocks, and night-by-night availability.
 * Cached per property and window (./cache.ts); what is not cached is loaded
 * for all properties together, in three queries. Server-side only.
 */
import type { Block, Booking } from "@/generated/prisma/client";
import { findOverlappingBlocks } from "@/lib/blocks/service";
import { toApiSource } from "@/lib/bookings/service";
import { fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import type { DateRange } from "@/lib/date-range";
import { db } from "@/lib/db";

import { readWindow, ticket, type Ticket, writeWindow } from "./cache";
import { dailyAvailability, type DayAvailability } from "./rules";

export type CalendarBooking = {
  id: string;
  checkIn: string;
  checkOut: string;
  status: Booking["status"];
  source: string;
  guest: { id: string; name: string };
};
export type CalendarBlock = {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  origin: Block["origin"];
};
export type PropertyCalendar = {
  property: { id: string; name: string; color: string; timezone: string; archived: boolean };
  /** Every non-cancelled booking touching the window, by check-in. */
  bookings: CalendarBooking[];
  blocks: CalendarBlock[];
  days: DayAvailability[];
};

/** Loads the calendars of `propertyIds` together; absent ids are missing from the map. */
async function loadCalendars(
  propertyIds: string[],
  range: DateRange,
): Promise<Map<string, PropertyCalendar>> {
  const [properties, bookings, blocks] = await Promise.all([
    db.property.findMany({ where: { id: { in: propertyIds } } }),
    db.booking.findMany({
      where: {
        propertyId: { in: propertyIds },
        status: { not: "cancelled" },
        checkIn: { lt: toUtcDate(range.end) },
        // Including stays ending on the first day, for their check-out marker.
        checkOut: { gte: toUtcDate(range.start) },
      },
      include: { guest: { select: { id: true, name: true } } },
      orderBy: [{ checkIn: "asc" }, { createdAt: "asc" }],
    }),
    findOverlappingBlocks(propertyIds, range),
  ]);

  return new Map(
    properties.map((property) => {
      const own = bookings
        .filter((b) => b.propertyId === property.id)
        .map((b): CalendarBooking => ({
          id: b.id,
          checkIn: fromUtcDate(b.checkIn),
          checkOut: fromUtcDate(b.checkOut),
          status: b.status,
          source: toApiSource(b.source),
          guest: b.guest,
        }));
      const ownBlocks = blocks
        .filter((b) => b.propertyId === property.id)
        .map((b): CalendarBlock => ({
          id: b.id,
          startDate: fromUtcDate(b.startDate),
          endDate: fromUtcDate(b.endDate),
          reason: b.reason,
          origin: b.origin,
        }));
      const calendar: PropertyCalendar = {
        property: {
          id: property.id,
          name: property.name,
          color: property.color,
          timezone: property.timezone,
          archived: property.archivedAt !== null,
        },
        bookings: own,
        blocks: ownBlocks,
        days: dailyAvailability(
          range,
          own.map((b) => ({ id: b.id, status: b.status, start: b.checkIn, end: b.checkOut })),
          ownBlocks.map((b) => ({ ...b, start: b.startDate, end: b.endDate })),
        ),
      };
      return [property.id, calendar];
    }),
  );
}

/**
 * The calendars of `propertyIds` over `range`, in the order asked for, from
 * the cache where possible. `missing` lists ids that are not properties.
 */
export async function getCalendars(
  propertyIds: string[],
  range: DateRange,
): Promise<{ calendars: PropertyCalendar[]; missing: string[] }> {
  const found = new Map<string, PropertyCalendar>();
  const toLoad: { id: string; since: Ticket }[] = [];
  for (const id of propertyIds) {
    const cached = readWindow<PropertyCalendar>(id, range);
    // The ticket is taken before the load reads, so an invalidation during
    // the load keeps its answer out of the cache.
    if (cached) found.set(id, cached);
    else toLoad.push({ id, since: ticket(id) });
  }

  if (toLoad.length > 0) {
    const loaded = await loadCalendars(
      toLoad.map((l) => l.id),
      range,
    );
    for (const { id, since } of toLoad) {
      const calendar = loaded.get(id);
      if (!calendar) continue;
      found.set(id, calendar);
      writeWindow(id, range, calendar, since);
    }
  }

  return {
    calendars: propertyIds.flatMap((id) => found.get(id) ?? []),
    missing: propertyIds.filter((id) => !found.has(id)),
  };
}
