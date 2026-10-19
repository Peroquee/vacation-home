/** Validation of seasons (GitLab #118). Server-side: the API's. */
import { z } from "zod";

import { MAX_AMOUNT_MINOR } from "@/lib/bookings/pricing";

import { isMonthDay, overlapping } from "./seasons";

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

const MAX_TAX_MINOR = 100_000;
export const AGES_OVERLAP = "overlaps another age group";
export const PERIODS_OVERLAP = "overlaps another period";
export const UNKNOWN_GROUP = "names an age group that does not exist";

const ageGroup = z
  .strictObject({ fromAge: whole(0, 17), toAge: whole(0, 17), rateMinor: whole(0, MAX_TAX_MINOR) })
  .refine((g) => g.fromAge <= g.toAge, { path: ["toAge"], message: "must not be below fromAge" });

const taxPeriod = z
  .strictObject({
    name: z.string().trim().min(1, "is required").max(60, "must be at most 60 characters"),
    startMonth: whole(1, 12),
    startDay: whole(1, 31),
    endMonth: whole(1, 12),
    endDay: whole(1, 31),
    adultRateMinor: whole(0, MAX_TAX_MINOR),
    childRatesMinor: z.record(z.string(), whole(0, MAX_TAX_MINOR)).default({}),
  })
  .superRefine((p, context) => {
    if (!isMonthDay(p.startMonth, p.startDay)) {
      context.addIssue({
        code: "custom",
        path: ["startDay"],
        message: "is not a day of that month",
      });
    }
    if (!isMonthDay(p.endMonth, p.endDay)) {
      context.addIssue({ code: "custom", path: ["endDay"], message: "is not a day of that month" });
    }
  });

/**
 * PUT /api/properties/:id/tourist-tax: the Kurtaxe rules (GitLab #120), or
 * null for none. Child groups are ages 0-17 and may not overlap; anyone else
 * pays the adult rate. Periods repeat every year and may not overlap; their
 * child rates name groups by "fromAge-toAge".
 */
export const touristTaxSchema = z.strictObject({
  rules: z
    .strictObject({
      adultRateMinor: whole(0, MAX_TAX_MINOR),
      childGroups: z.array(ageGroup).max(4, "must be at most 4 age groups").default([]),
      periods: z.array(taxPeriod).max(4, "must be at most 4 periods").default([]),
      maxNights: whole(1, 365).nullable().default(null),
      included: z.boolean({ error: "must be true or false" }).default(false),
    })
    .superRefine((rules, context) => {
      const sorted = [...rules.childGroups].sort((a, b) => a.fromAge - b.fromAge);
      sorted.forEach((group, i) => {
        if (i > 0 && group.fromAge <= sorted[i - 1]!.toAge) {
          context.addIssue({ code: "custom", path: ["childGroups"], message: AGES_OVERLAP });
        }
      });
      const keys = new Set(rules.childGroups.map((g) => `${g.fromAge}-${g.toAge}`));
      rules.periods.forEach((period, i) => {
        if (Object.keys(period.childRatesMinor).some((key) => !keys.has(key))) {
          context.addIssue({
            code: "custom",
            path: ["periods", i, "childRatesMinor"],
            message: UNKNOWN_GROUP,
          });
        }
        if (
          overlapping(
            { ...period, year: null },
            rules.periods.slice(0, i).map((p) => ({ ...p, year: null })),
          )
        ) {
          context.addIssue({
            code: "custom",
            path: ["periods", i, "startDay"],
            message: PERIODS_OVERLAP,
          });
        }
      });
    })
    .transform((rules) => ({
      ...rules,
      childGroups: [...rules.childGroups].sort((a, b) => a.fromAge - b.fromAge),
    }))
    .nullable(),
});
