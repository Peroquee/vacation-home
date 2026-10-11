/**
 * Validation of a property's booking rules (PUT /api/properties/:id/booking-rules).
 * The database checks the same bounds (prisma/migrations/*_booking_rules).
 */
import { z } from "zod";

import { stayProblem } from "@/lib/bookings/values";
import { isCalendarDate } from "@/lib/calendar-date";

/** The app's longest stay (src/lib/bookings/schema.ts) bounds the night rules. */
export const MAX_NIGHTS = 365;
/** Lead time and horizon: up to three years. */
export const MAX_DAYS_AHEAD = 1095;
export const MAX_BUFFER_DAYS = 30;

const whole = (min: number, max: number) =>
  z
    .int({ error: `must be a whole number from ${min} to ${max}` })
    .min(min, `must be a whole number from ${min} to ${max}`)
    .max(max, `must be a whole number from ${min} to ${max}`);

const WEEKDAYS = "must be weekdays from 1 (Monday) to 7 (Sunday), each once";

export const bookingRulesSchema = z
  .strictObject({
    minNights: whole(1, MAX_NIGHTS),
    maxNights: whole(1, MAX_NIGHTS).nullable(),
    minLeadDays: whole(0, MAX_DAYS_AHEAD),
    horizonDays: whole(1, MAX_DAYS_AHEAD).nullable(),
    checkInWeekdays: z
      .array(z.int({ error: WEEKDAYS }).min(1, WEEKDAYS).max(7, WEEKDAYS), { error: WEEKDAYS })
      .refine((days) => new Set(days).size === days.length, { error: WEEKDAYS })
      .transform((days) => [...days].sort((a, b) => a - b)),
    bufferDays: whole(0, MAX_BUFFER_DAYS),
  })
  .superRefine((rules, context) => {
    if (rules.maxNights !== null && rules.maxNights < rules.minNights) {
      context.addIssue({
        code: "custom",
        path: ["maxNights"],
        message: "must not be less than the minimum stay",
      });
    }
    if (rules.horizonDays !== null && rules.horizonDays <= rules.minLeadDays) {
      context.addIssue({
        code: "custom",
        path: ["horizonDays"],
        message: "must be more than the lead time",
      });
    }
  });

export type BookingRulesInput = z.infer<typeof bookingRulesSchema>;

const date = z.string().refine(isCalendarDate, "must be a date as YYYY-MM-DD");

/** `?checkIn=&checkOut=` of a stay to check; the same date rules as bookings. */
export const stayQuerySchema = z
  .object({ checkIn: date, checkOut: date, ignoreBookingId: z.uuid().optional() })
  .superRefine(({ checkIn, checkOut }, context) => {
    if (!isCalendarDate(checkIn) || !isCalendarDate(checkOut)) return;
    const problem = stayProblem(checkIn, checkOut);
    if (problem) context.addIssue({ code: "custom", path: ["checkOut"], message: problem });
  });
