/**
 * Booking arithmetic. Check-out is exclusive (see the Booking model), so the
 * number of nights is simply the days between the two dates. Prices come
 * from the price engine, src/lib/pricing/engine.ts (GitLab #118).
 */
import { type CalendarDate, daysBetween } from "@/lib/calendar-date";

/** The largest amount a money column holds: PostgreSQL `integer`. */
export const MAX_AMOUNT_MINOR = 2_147_483_647;

/** Nights in a stay; at least 1 for any valid booking. */
export function nights(checkIn: CalendarDate, checkOut: CalendarDate): number {
  const count = daysBetween(checkIn, checkOut);
  if (count < 1) {
    throw new RangeError(`check-out ${checkOut} must be after check-in ${checkIn}`);
  }
  return count;
}
