/** Validation of a payment recorded on a booking (GitLab #115). */
import { z } from "zod";

import { MAX_AMOUNT_MINOR } from "@/lib/bookings/pricing";
import { isCalendarDate } from "@/lib/calendar-date";

import { PAYMENT_KINDS, PAYMENT_METHODS } from "./values";

export { PAYMENT_KINDS, PAYMENT_METHODS };

/** POST /api/bookings/:id/payments. */
export const paymentSchema = z.strictObject({
  kind: z.enum(PAYMENT_KINDS),
  method: z.enum(PAYMENT_METHODS).default("bank_transfer"),
  amountMinor: z
    .int({ error: "must be a whole number of minor units (cents)" })
    .min(1, "must be at least 1")
    .max(MAX_AMOUNT_MINOR, "is too large"),
  receivedOn: z.string().trim().refine(isCalendarDate, "must be a date as YYYY-MM-DD"),
  note: z
    .string()
    .trim()
    .max(500, "must be at most 500 characters")
    .nullable()
    .optional()
    .transform((value) => value || null),
});
