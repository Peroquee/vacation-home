/**
 * Booking arithmetic. Check-out is exclusive (see the Booking model), so the
 * number of nights is simply the days between the two dates.
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

/**
 * The default total: nights x nightly rate + cleaning fee, in minor units.
 * Integer arithmetic throughout, so it is exact; refuses a total the money
 * column could not store rather than letting it wrap or lose precision.
 */
export function calculateTotalMinor({
  checkIn,
  checkOut,
  nightlyRateMinor,
  cleaningFeeMinor,
}: {
  checkIn: CalendarDate;
  checkOut: CalendarDate;
  nightlyRateMinor: number;
  cleaningFeeMinor: number;
}): number {
  for (const [name, value] of Object.entries({ nightlyRateMinor, cleaningFeeMinor })) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative integer number of minor units`);
    }
  }
  const total = nights(checkIn, checkOut) * nightlyRateMinor + cleaningFeeMinor;
  if (total > MAX_AMOUNT_MINOR) {
    throw new RangeError(`total ${total} exceeds the largest storable amount`);
  }
  return total;
}
