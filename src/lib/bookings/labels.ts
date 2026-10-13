/**
 * The message keys booking statuses and sources read as on screen
 * (`bookings.status.*`, `bookings.source.*`). Client-safe. A key cannot hold
 * a dot, hence "bookingCom".
 */
import type { ApiBookingSource } from "./values";

export const SOURCE_KEYS = {
  direct: "direct",
  airbnb: "airbnb",
  "booking.com": "bookingCom",
  other: "other",
  website: "website",
} as const satisfies Record<ApiBookingSource, string>;
