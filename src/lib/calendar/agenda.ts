/**
 * The mobile agenda: a month's stays and blocks as a list, in date order,
 * across the properties shown. Client-safe.
 */
import type { CalendarBlock, CalendarBooking } from "@/lib/availability/calendar";
import type { CalendarDate } from "@/lib/calendar-date";
import { addMonths, type MonthKey } from "@/lib/calendar/month";

type Property = { id: string; name: string; color: string };

export type AgendaItem =
  | {
      kind: "booking";
      id: string;
      start: CalendarDate;
      end: CalendarDate;
      property: Property;
      booking: CalendarBooking;
    }
  | {
      kind: "block";
      id: string;
      start: CalendarDate;
      end: CalendarDate;
      property: Property;
      block: CalendarBlock;
    };

/** `[first day, first day of the next month)`. */
export function monthWindow(month: MonthKey): { start: CalendarDate; end: CalendarDate } {
  return { start: `${month}-01`, end: `${addMonths(month, 1)}-01` };
}

/**
 * Everything that occupies a night of `month`, earliest first; a stay
 * running across months appears in each of them. Ties sort by property, in
 * the order the properties were given.
 */
export function agendaItems(
  month: MonthKey,
  calendars: { property: Property; bookings: CalendarBooking[]; blocks: CalendarBlock[] }[],
): AgendaItem[] {
  const { start, end } = monthWindow(month);
  const overlaps = (from: CalendarDate, to: CalendarDate) => from < end && to > start;
  const items = calendars.flatMap(({ property, bookings, blocks }, order) => [
    ...bookings
      .filter((b) => overlaps(b.checkIn, b.checkOut))
      .map((booking) => ({
        order,
        item: {
          kind: "booking",
          id: booking.id,
          start: booking.checkIn,
          end: booking.checkOut,
          property,
          booking,
        } satisfies AgendaItem,
      })),
    ...blocks
      .filter((b) => overlaps(b.startDate, b.endDate))
      .map((block) => ({
        order,
        item: {
          kind: "block",
          id: block.id,
          start: block.startDate,
          end: block.endDate,
          property,
          block,
        } satisfies AgendaItem,
      })),
  ]);
  return items
    .sort((a, b) =>
      a.item.start < b.item.start ? -1 : a.item.start > b.item.start ? 1 : a.order - b.order,
    )
    .map(({ item }): AgendaItem => item);
}
