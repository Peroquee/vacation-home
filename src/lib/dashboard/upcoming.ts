/** Upcoming arrivals for the dashboard. Server-side only. */
import { addDays, type CalendarDate, toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

/** Confirmed bookings checking in from `today` for the next `days` days. */
export async function countUpcoming(
  today: CalendarDate,
  days: number,
  propertyId?: string,
): Promise<number> {
  return db.booking.count({
    where: {
      status: "confirmed",
      ...(propertyId && { propertyId }),
      checkIn: { gte: toUtcDate(today), lt: toUtcDate(addDays(today, days)) },
    },
  });
}
