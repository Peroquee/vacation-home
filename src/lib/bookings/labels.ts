/** How booking statuses and sources read on screen. Client-safe. */
import type { ApiBookingSource, BOOKING_STATUSES } from "./schema";

export const STATUS_LABELS: Record<(typeof BOOKING_STATUSES)[number], string> = {
  inquiry: "Inquiry",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

export const SOURCE_LABELS: Record<ApiBookingSource, string> = {
  direct: "Direct",
  airbnb: "Airbnb",
  "booking.com": "Booking.com",
  other: "Other",
};
