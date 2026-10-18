/** Input validation for bookings, shared by the API and the booking form. */
import { z } from "zod";

import { isCalendarDate } from "@/lib/calendar-date";
import { csv, fromBeforeTo, page, pageSize } from "@/lib/query";

import { MAX_AMOUNT_MINOR } from "./pricing";

import {
  BOOKING_SORTS,
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  FLOW_ONLY,
  FLOW_STATUSES,
  stayProblem,
  WEBSITE_ONLY,
} from "./values";

export * from "./values";

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

export const GUESTS_NOT_THE_SUM = "must be the sum of the guests by age group";

/** Who stays, by age group (GitLab #120): only as detailed as the Kurtaxe needs. */
export const guestSplitSchema = z
  .strictObject({
    adults: z.int("must be a whole number").min(0, "cannot be negative").max(50, "is too many"),
    children: z
      .array(
        z.strictObject({
          fromAge: z.int().min(0).max(17),
          toAge: z.int().min(0).max(17),
          count: z
            .int("must be a whole number")
            .min(0, "cannot be negative")
            .max(50, "is too many"),
        }),
      )
      .max(4, "must be at most 4 age groups")
      .default([]),
  })
  .refine(
    (split) => {
      const total = split.adults + split.children.reduce((sum, c) => sum + c.count, 0);
      return total >= 1 && total <= 50;
    },
    { message: "must be from 1 to 50 guests" },
  );

export const guestsAddUp = (
  input: { guestCount?: number; guestSplit?: z.infer<typeof guestSplitSchema> | null },
  context: z.RefinementCtx,
) => {
  if (!input.guestSplit || input.guestCount === undefined) return;
  const sum = input.guestSplit.adults + input.guestSplit.children.reduce((s, c) => s + c.count, 0);
  if (sum !== input.guestCount) {
    context.addIssue({ code: "custom", path: ["guestCount"], message: GUESTS_NOT_THE_SUM });
  }
};

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
  guestSplit: guestSplitSchema,
  notes,
  /** The owner's own Kurtaxe for the booking (an exemption); null: by the rules. */
  touristTaxMinor: amountMinor.nullable(),
  touristTaxNote: z
    .string()
    .trim()
    .max(500, "must be at most 500 characters")
    .nullable()
    .transform((value) => value || null),
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
 * POST /api/bookings. The nights are priced by the property's seasons and
 * default rate (src/lib/pricing/engine.ts) unless `nightlyRateMinor` gives
 * the booking its own flat rate; the cleaning fee defaults to the
 * property's. The total is calculated unless `totalAmountMinor` is given,
 * which sets it by hand.
 */
export const createBookingSchema = z
  .strictObject({
    propertyId: fields.propertyId,
    guestId: fields.guestId,
    checkIn: fields.checkIn,
    checkOut: fields.checkOut,
    // Reserved and expired come with the flow's own data (the payment
    // terms, the expiry), so only the flow sets them; see updateBooking too.
    status: fields.status
      .refine((status) => !(FLOW_STATUSES as readonly string[]).includes(status), FLOW_ONLY)
      .default("inquiry"),
    source: fields.source.refine((source) => source !== "website", WEBSITE_ONLY).default("direct"),
    // Default 1, or the sum of guestSplit (src/lib/bookings/service.ts).
    guestCount: fields.guestCount.optional(),
    nightlyRateMinor: fields.nightlyRateMinor.nullable().optional(),
    cleaningFeeMinor: fields.cleaningFeeMinor.optional(),
    totalAmountMinor: amountMinor.optional(),
    // With it, guestCount may be left out: it is the sum.
    guestSplit: fields.guestSplit.optional(),
    touristTaxMinor: fields.touristTaxMinor.optional(),
    touristTaxNote: fields.touristTaxNote.optional(),
    notes: notes.optional(),
  })
  .superRefine(checkStay)
  .superRefine(guestsAddUp);

/**
 * PATCH /api/bookings/:id: any subset of fields. `totalAmountMinor` sets the
 * total by hand; `null` hands it back to the calculation. `nightlyRateMinor`
 * null prices the nights by the seasons again. The total is worked out anew
 * only when the dates, the rate or the cleaning fee change (or a hand-set
 * total is handed back): editing anything else keeps the agreed price. The property
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
    nightlyRateMinor: fields.nightlyRateMinor.nullable(),
    cleaningFeeMinor: fields.cleaningFeeMinor,
    totalAmountMinor: amountMinor.nullable(),
    guestSplit: fields.guestSplit,
    touristTaxMinor: fields.touristTaxMinor,
    touristTaxNote: fields.touristTaxNote,
    notes,
  })
  .partial()
  .refine((update) => Object.keys(update).length > 0, "at least one field is required")
  .superRefine(checkStay)
  .superRefine(guestsAddUp);

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
    page,
    pageSize: pageSize(100, 25),
    sort: z.enum(BOOKING_SORTS).default("checkIn"),
  })
  .refine(...fromBeforeTo);

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
export type ListBookingsQuery = z.infer<typeof listBookingsSchema>;
