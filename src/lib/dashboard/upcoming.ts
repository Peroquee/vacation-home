/** Upcoming arrivals for the dashboard. Server-side only. */
import { addDays, type CalendarDate, toUtcDate } from "@/lib/calendar-date";
import { HOLDING_STATUSES } from "@/lib/bookings/values";
import { db } from "@/lib/db";

/**
 * Bookings holding their dates (reserved, confirmed, paid) checking in from
 * `today` for the next `days` days.
 */
export async function countUpcoming(
  today: CalendarDate,
  days: number,
  propertyId?: string,
): Promise<number> {
  return db.booking.count({
    where: {
      status: { in: [...HOLDING_STATUSES] },
      ...(propertyId && { propertyId }),
      checkIn: { gte: toUtcDate(today), lt: toUtcDate(addDays(today, days)) },
    },
  });
}
