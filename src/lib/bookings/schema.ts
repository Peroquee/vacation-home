/** Input validation for bookings, shared by the API and the booking form. */
import { z } from "zod";

import { daysBetween, isCalendarDate } from "@/lib/calendar-date";

import { MAX_AMOUNT_MINOR } from "./pricing";

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

const calendarDate = z.string().trim().refine(isCalendarDate, "must be a date as YYYY-MM-DD");

const amountMinor = z
  .int({ error: "must be a whole number of minor units (cents)" })
  .min(0, "cannot be negative")
  .max(MAX_AMOUNT_MINOR, "is too large");

const notes = z
  .string()
  .trim()
  .max(2000, "must be at most 2000 characters")
  .nullable()
  .transform((value) => value || null);

const fields = {
  propertyId: z.uuid("must be a property id"),
  guestId: z.uuid("must be a guest id"),
  checkIn: calendarDate,
  checkOut: calendarDate,
  status: z.enum(BOOKING_STATUSES),
  source: z.enum(BOOKING_SOURCES),
  guestCount: z.int("must be a whole number").min(1, "must be at least 1").max(50, "is too many"),
  nightlyRateMinor: amountMinor,
  cleaningFeeMinor: amountMinor,
  notes,
};

/**
 * Check-out must follow check-in, within MAX_NIGHTS. Reported on checkOut.
 * Like any object-level check, Zod runs it once the fields themselves are
 * valid; it still checks the dates' shape, to stand on its own.
 */
function checkStay(
  stay: { checkIn?: unknown; checkOut?: unknown },
  context: z.RefinementCtx,
): void {
  const { checkIn, checkOut } = stay;
  if (typeof checkIn !== "string" || typeof checkOut !== "string") return;
  if (!isCalendarDate(checkIn) || !isCalendarDate(checkOut)) return;
  const problem = stayProblem(checkIn, checkOut);
  if (problem) context.addIssue({ code: "custom", path: ["checkOut"], message: problem });
}

/**
 * POST /api/bookings. Rates default to the property's; the total is
 * calculated (nights x rate + cleaning fee) unless `totalAmountMinor` is
 * given, which sets it by hand.
 */
export const createBookingSchema = z
  .strictObject({
    propertyId: fields.propertyId,
    guestId: fields.guestId,
    checkIn: fields.checkIn,
    checkOut: fields.checkOut,
    status: fields.status.default("inquiry"),
    source: fields.source.default("direct"),
    guestCount: fields.guestCount.default(1),
    nightlyRateMinor: fields.nightlyRateMinor.optional(),
    cleaningFeeMinor: fields.cleaningFeeMinor.optional(),
    totalAmountMinor: amountMinor.optional(),
    notes: notes.optional(),
  })
  .superRefine(checkStay);

/**
 * PATCH /api/bookings/:id: any subset of fields. `totalAmountMinor` sets the
 * total by hand; `null` hands it back to the calculation. The property
 * cannot change - the booking's amounts are in its currency.
 */
export const updateBookingSchema = z
  .strictObject({
    guestId: fields.guestId,
    checkIn: fields.checkIn,
    checkOut: fields.checkOut,
    status: fields.status,
    source: fields.source,
    guestCount: fields.guestCount,
    nightlyRateMinor: fields.nightlyRateMinor,
    cleaningFeeMinor: fields.cleaningFeeMinor,
    totalAmountMinor: amountMinor.nullable(),
    notes,
  })
  .partial()
  .refine((update) => Object.keys(update).length > 0, "at least one field is required")
  .superRefine(checkStay);

const csv = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value !== ""
        ? value.split(",").map((part) => part.trim())
        : undefined,
    z.array(item).optional(),
  );

/** `?page=` with no value means the default, not zero. */
const blankAsDefault = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

/** GET /api/bookings query string. */
export const listBookingsSchema = z
  .object({
    propertyId: fields.propertyId.optional(),
    /** Stays overlapping [from, to); either end may be left open. */
    from: calendarDate.optional(),
    to: calendarDate.optional(),
    status: csv(fields.status),
    source: csv(fields.source),
    /** Part of the guest's name or email, any case. */
    q: z.string().trim().max(200).optional(),
    page: blankAsDefault(z.coerce.number().int().min(1).default(1)),
    pageSize: blankAsDefault(z.coerce.number().int().min(1).max(100).default(25)),
    sort: z.enum(["checkIn", "-checkIn"]).default("checkIn"),
  })
  .refine(
    (query) =>
      typeof query.from !== "string" ||
      typeof query.to !== "string" ||
      !isCalendarDate(query.from) ||
      !isCalendarDate(query.to) ||
      query.from < query.to,
    { path: ["to"], message: "must be after from" },
  );

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
export type ListBookingsQuery = z.infer<typeof listBookingsSchema>;
