/**
 * Everything a calendar view needs for some properties over a date window, in
 * one call: their bookings and blocks, and night-by-night availability.
 * Cached per property and window (./cache.ts). Server-side only.
 */
import { fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import type { DateRange } from "@/lib/date-range";
import { db } from "@/lib/db";

import { readWindow, writeWindow } from "./cache";
import { dailyAvailability, type DayAvailability } from "./rules";

export type CalendarBooking = {
  id: string;
  checkIn: string;
  checkOut: string;
  status: "inquiry" | "confirmed" | "cancelled";
  source: string;
  guest: { id: string; name: string };
};
export type CalendarBlock = {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  origin: "manual" | "google";
};
export type PropertyCalendar = {
  property: { id: string; name: string; color: string; timezone: string; archived: boolean };
  /** Every non-cancelled booking touching the window, by check-in. */
  bookings: CalendarBooking[];
  blocks: CalendarBlock[];
  days: DayAvailability[];
};

async function loadCalendar(
  propertyId: string,
  range: DateRange,
): Promise<PropertyCalendar | null> {
  const start = toUtcDate(range.start);
  const end = toUtcDate(range.end);
  const [property, bookings, blocks] = await Promise.all([
    db.property.findUnique({ where: { id: propertyId } }),
    db.booking.findMany({
      where: {
        propertyId,
        status: { not: "cancelled" },
        checkIn: { lt: end },
        // Including stays ending on the first day, for their check-out marker.
        checkOut: { gte: start },
      },
      include: { guest: { select: { id: true, name: true } } },
      orderBy: [{ checkIn: "asc" }, { createdAt: "asc" }],
    }),
    db.block.findMany({
      where: { propertyId, startDate: { lt: end }, endDate: { gt: start } },
      orderBy: { startDate: "asc" },
    }),
  ]);
  if (!property) return null;

  const calendarBookings: CalendarBooking[] = bookings.map((b) => ({
    id: b.id,
    checkIn: fromUtcDate(b.checkIn),
    checkOut: fromUtcDate(b.checkOut),
    status: b.status,
    source: b.source === "booking_com" ? "booking.com" : b.source,
    guest: b.guest,
  }));
  const calendarBlocks: CalendarBlock[] = blocks.map((b) => ({
    id: b.id,
    startDate: fromUtcDate(b.startDate),
    endDate: fromUtcDate(b.endDate),
    reason: b.reason,
    origin: b.origin,
  }));

  return {
    property: {
      id: property.id,
      name: property.name,
      color: property.color,
      timezone: property.timezone,
      archived: property.archivedAt !== null,
    },
    bookings: calendarBookings,
    blocks: calendarBlocks,
    days: dailyAvailability(
      range,
      calendarBookings.map((b) => ({
        id: b.id,
        status: b.status,
        start: b.checkIn,
        end: b.checkOut,
      })),
      calendarBlocks.map((b) => ({
        id: b.id,
        reason: b.reason,
        origin: b.origin,
        start: b.startDate,
        end: b.endDate,
      })),
    ),
  };
}

/**
 * The calendars of `propertyIds` over `range`, in the order asked for, from
 * the cache where possible. `missing` lists ids that are not properties.
 */
export async function getCalendars(
  propertyIds: string[],
  range: DateRange,
): Promise<{ calendars: PropertyCalendar[]; missing: string[] }> {
  const results = await Promise.all(
    propertyIds.map(async (id) => {
      const cached = readWindow<PropertyCalendar>(id, range);
      if (cached) return { id, calendar: cached };
      const calendar = await loadCalendar(id, range);
      if (calendar) writeWindow(id, range, calendar);
      return { id, calendar };
    }),
  );
  return {
    calendars: results.flatMap((r) => (r.calendar ? [r.calendar] : [])),
    missing: results.filter((r) => !r.calendar).map((r) => r.id),
  };
}
