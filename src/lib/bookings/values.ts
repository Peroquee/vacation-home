/**
 * The booking values and rules the browser needs too (the booking form, the
 * calendar), kept free of zod so client bundles stay small. The schemas in
 * ./schema.ts build on them and re-export them.
 */
import { daysBetween } from "@/lib/calendar-date";

/** The longest stay accepted, in nights. */
export const MAX_NIGHTS = 365;

/**
 * What is wrong with a stay, or null: check-out must follow check-in, within
 * MAX_NIGHTS. The one statement of the rule - the schema applies it to a
 * request, the service to a stored stay merged with a one-sided change.
 */
export function stayProblem(checkIn: string, checkOut: string): string | null {
  const nights = daysBetween(checkIn, checkOut);
  if (nights < 1) return "must be after check-in";
  if (nights > MAX_NIGHTS) return `a stay can be at most ${MAX_NIGHTS} nights`;
  return null;
}

export const BOOKING_STATUSES = ["inquiry", "confirmed", "cancelled"] as const;
/** As the API speaks them; stored as the BookingSource enum. */
export const BOOKING_SOURCES = ["direct", "airbnb", "booking.com", "other"] as const;
export type ApiBookingSource = (typeof BOOKING_SOURCES)[number];

/** List orders: a column, ascending, or with a leading "-", descending. */
export const BOOKING_SORTS = [
  "checkIn",
  "-checkIn",
  "guest",
  "-guest",
  "property",
  "-property",
  "status",
  "-status",
  "source",
  "-source",
  "total",
  "-total",
] as const;
export type BookingSort = (typeof BOOKING_SORTS)[number];
