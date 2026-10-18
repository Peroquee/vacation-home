/** Validation of seasons (GitLab #118). Server-side: the API's. */
import { z } from "zod";

import { MAX_AMOUNT_MINOR } from "@/lib/bookings/pricing";

import { isMonthDay } from "./seasons";

export const SEASON_OVERLAPS = "overlaps another season";

const whole = (min: number, max: number) =>
  z
    .int({ error: `must be a whole number from ${min} to ${max}` })
    .min(min, `must be a whole number from ${min} to ${max}`)
    .max(max, `must be a whole number from ${min} to ${max}`);

/** POST and PUT /api/properties/:id/seasons[/:seasonId]: the whole season. */
export const seasonSchema = z
  .strictObject({
    name: z
      .string({ error: "is required" })
      .trim()
      .min(1, "is required")
      .max(60, "must be at most 60 characters"),
    startMonth: whole(1, 12),
    startDay: whole(1, 31),
    endMonth: whole(1, 12),
    endDay: whole(1, 31),
    // Null or missing: every year.
    year: whole(2000, 2100).nullable().default(null),
    rateMinor: whole(0, MAX_AMOUNT_MINOR),
  })
  .superRefine((season, context) => {
    for (const [month, day, path] of [
      [season.startMonth, season.startDay, "startDay"],
      [season.endMonth, season.endDay, "endDay"],
    ] as const) {
      if (!isMonthDay(month, day)) {
        context.addIssue({ code: "custom", path: [path], message: "is not a day of that month" });
      }
    }
    // 29 February exists in a given year only if it is a leap year.
    if (season.year !== null) {
      const leap = (y: number) => new Date(Date.UTC(y, 1, 29)).getUTCMonth() === 1;
      const endYear =
        season.year +
        (season.endMonth * 100 + season.endDay < season.startMonth * 100 + season.startDay ? 1 : 0);
      for (const [month, day, y, path] of [
        [season.startMonth, season.startDay, season.year, "startDay"],
        [season.endMonth, season.endDay, endYear, "endDay"],
      ] as const) {
        if (month === 2 && day === 29 && !leap(y)) {
          context.addIssue({ code: "custom", path: [path], message: "is not a day of that year" });
        }
      }
    }
  });
export type SeasonInput = z.infer<typeof seasonSchema>;

export const DISCOUNT_NIGHTS_TAKEN = "already has a discount for this many nights";

/** PUT /api/properties/:id/stay-discounts: every tier (GitLab #119); empty for none. */
export const stayDiscountsSchema = z.strictObject({
  tiers: z
    .array(z.strictObject({ minNights: whole(2, 365), percent: whole(1, 90) }))
    .max(10, "must be at most 10 tiers")
    .superRefine((tiers, context) => {
      const seen = new Set<number>();
      tiers.forEach((tier, i) => {
        if (seen.has(tier.minNights)) {
          context.addIssue({
            code: "custom",
            path: [i, "minNights"],
            message: DISCOUNT_NIGHTS_TAKEN,
          });
        }
        seen.add(tier.minNights);
      });
    })
    .transform((tiers) => [...tiers].sort((a, b) => a.minNights - b.minNights)),
});
