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

/**
 * The booking flow (GitLab #114): inquiry (also a request from the public
 * site) -> reserved (accepted, awaiting payment) -> confirmed (deposit
 * received) -> paid; a reservation not paid in time -> expired. A booking
 * the owner enters is simply inquiry, confirmed or cancelled, as ever.
 */
export const BOOKING_STATUSES = [
  "inquiry",
  "reserved",
  "confirmed",
  "paid",
  "expired",
  "cancelled",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * The statuses that hold a booking's dates against every other booking and
 * block. THE list: the database's exclusion constraint and triggers
 * (prisma/migrations/20261013030000_reservation_hold) name the same, and a
 * DB test proves they agree.
 */
export const HOLDING_STATUSES = [
  "reserved",
  "confirmed",
  "paid",
] as const satisfies readonly BookingStatus[];

/** Whether a booking in `status` holds its dates. */
export function holdsDates(status: BookingStatus): boolean {
  return (HOLDING_STATUSES as readonly string[]).includes(status);
}

/**
 * The statuses of a stay that will happen and earn: the deposit, or all of
 * it, received. Income, revenue and occupancy count these; a reservation
 * still awaiting payment holds the dates but is not counted yet.
 */
export const BOOKED_STATUSES = ["confirmed", "paid"] as const satisfies readonly BookingStatus[];

export function isBooked(status: BookingStatus): boolean {
  return (BOOKED_STATUSES as readonly string[]).includes(status);
}

/**
 * Statuses only the flow sets: accepting a request reserves it (with its
 * payment terms), and the hold job lets an unpaid one expire. Neither can
 * be chosen when creating or editing a booking.
 */
export const FLOW_STATUSES = ["reserved", "expired"] as const satisfies readonly BookingStatus[];
export const FLOW_ONLY = "is set by the booking flow only";

/**
 * The statuses the owner may set by hand (GitLab #135), and only on a
 * booking outside the payment flow: entered by hand (not from the website),
 * never reserved, no payment recorded - a platform booking, paid there, or
 * one by phone. Everything else moves through the actions: accept, record a
 * payment, cancel, reinstate.
 */
export const HAND_STATUSES = [
  "inquiry",
  "confirmed",
  "paid",
] as const satisfies readonly BookingStatus[];
export const STATUS_BY_ACTION =
  "is changed by the booking's actions only: accept, record a payment, cancel or reinstate";
export const ONLY_ENDED = "only a cancelled or expired booking can be reinstated";
export const MONEY_HELD =
  "cannot be reinstated while money is held: refund it first, or make a new booking";

/** Whether a booking's status is the owner's to set by hand. */
export function statusByHand(booking: {
  source: string;
  status: string;
  reservedAt: Date | string | null;
  hasPayments: boolean;
}): boolean {
  return (
    booking.source !== "website" &&
    booking.reservedAt === null &&
    !booking.hasPayments &&
    (HAND_STATUSES as readonly string[]).includes(booking.status)
  );
}
/**
 * As the API speaks them; stored as the BookingSource enum. "website" is a
 * request from the public booking site (GitLab #109): only that site
 * creates one, with its reference and the guest's privacy consent.
 */
export const BOOKING_SOURCES = ["direct", "airbnb", "booking.com", "other", "website"] as const;
export type ApiBookingSource = (typeof BOOKING_SOURCES)[number];
export const WEBSITE_ONLY = "is set by the public booking site only";

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
