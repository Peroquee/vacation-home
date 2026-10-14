/**
 * Validation of a property's payment terms (PUT /api/properties/:id/payment-terms)
 * and of a deadline changed by hand. The database checks the same bounds
 * (prisma/migrations/*_reservation_hold).
 */
import { z } from "zod";

import { MAX_AMOUNT_MINOR } from "@/lib/bookings/pricing";
import { isCalendarDate } from "@/lib/calendar-date";

const whole = (min: number, max: number) =>
  z
    .int({ error: `must be a whole number from ${min} to ${max}` })
    .min(min, `must be a whole number from ${min} to ${max}`)
    .max(max, `must be a whole number from ${min} to ${max}`);

export const DEPOSIT_ONE_OF = "give either a percentage or a fixed amount";

export const paymentTermsSchema = z
  .strictObject({
    depositPercent: whole(1, 100).nullable(),
    depositFixedMinor: z
      .int({ error: "must be a whole number of minor units (cents)" })
      .min(1, "must be at least 1")
      .max(MAX_AMOUNT_MINOR, "is too large")
      .nullable(),
    depositDueDays: whole(1, 60),
    balanceDueDaysBefore: whole(0, 365),
    fullPaymentDueDays: whole(1, 60),
  })
  .superRefine((terms, context) => {
    if ((terms.depositPercent === null) === (terms.depositFixedMinor === null)) {
      context.addIssue({ code: "custom", path: ["depositPercent"], message: DEPOSIT_ONE_OF });
    }
  });

export type PaymentTermsInput = z.infer<typeof paymentTermsSchema>;

const date = z.string().trim().refine(isCalendarDate, "must be a date as YYYY-MM-DD");

/** PATCH /api/bookings/:id/deadlines: either or both, e.g. a few more days for the deposit. */
export const deadlinesSchema = z
  .strictObject({ depositDueOn: date.optional(), balanceDueOn: date.optional() })
  .refine((input) => input.depositDueOn || input.balanceDueOn, "at least one field is required");

export type DeadlinesInput = z.infer<typeof deadlinesSchema>;
