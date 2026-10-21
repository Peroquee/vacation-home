/**
 * Validation of the listing profile and photo details (GitLab #106). The
 * database checks the counts and times too
 * (prisma/migrations/20261011030000_listing_profile).
 */
import { z } from "zod";

import type { StayTimes } from "./stay-times";
import { AMENITIES, LISTING_LIMITS, TIME } from "./values";

const text = (max: number) =>
  z.string().trim().max(max, `must be at most ${max} characters`).default("");

const count = (min: number) =>
  z
    .int({ error: `must be a whole number from ${min} to ${LISTING_LIMITS.count}` })
    .min(min, `must be a whole number from ${min} to ${LISTING_LIMITS.count}`)
    .max(LISTING_LIMITS.count, `must be a whole number from ${min} to ${LISTING_LIMITS.count}`)
    .nullable()
    .default(null);

const time = z
  .string()
  .trim()
  .refine((value) => value === "" || TIME.test(value), "must be a time like 15:00")
  .nullable()
  .default(null)
  // Blank means not given.
  .transform((value) => value || null);

/**
 * PUT /api/properties/:id/listing: the whole profile; missing fields are
 * blank. The arrival and departure times have their own (GitLab #126).
 */
export const listingSchema = z.strictObject({
  titleEn: text(LISTING_LIMITS.title),
  titleDe: text(LISTING_LIMITS.title),
  descriptionEn: text(LISTING_LIMITS.description),
  descriptionDe: text(LISTING_LIMITS.description),
  houseRulesEn: text(LISTING_LIMITS.houseRules),
  houseRulesDe: text(LISTING_LIMITS.houseRules),
  location: text(LISTING_LIMITS.location),
  maxGuests: count(1),
  bedrooms: count(0),
  bathrooms: count(0),
  amenities: z
    .array(z.enum(AMENITIES, { error: "must be amenities from the list" }))
    .default([])
    .transform((list) => [...new Set(list)].sort()),
  // Owner-only (GitLab #111): sent in the final confirmation, never public.
  exactAddress: text(LISTING_LIMITS.exactAddress),
  arrivalNotes: text(LISTING_LIMITS.arrivalNotes),
});
export type ListingInput = z.infer<typeof listingSchema>;

// --- Arrival and departure times (GitLab #126) ------------------------------

/** PUT /api/properties/:id/stay-times: all three; missing ones are unset. */
export const stayTimesSchema = z
  .strictObject({ checkInTime: time, earliestCheckOutTime: time, checkOutTime: time })
  .superRefine((times, context) => {
    if (
      times.earliestCheckOutTime &&
      times.checkOutTime &&
      times.earliestCheckOutTime > times.checkOutTime
    ) {
      context.addIssue({
        code: "custom",
        path: ["earliestCheckOutTime"],
        message: "must not be later than the latest departure",
      });
    }
  });

const snapshot = z.object({
  checkInTime: z.string().regex(TIME).nullable(),
  earliestCheckOutTime: z.string().regex(TIME).nullable(),
  checkOutTime: z.string().regex(TIME).nullable(),
});

/** A booking's stay_times, or null when it has none (or an unreadable one). */
export function parseStayTimes(value: unknown): StayTimes | null {
  const parsed = snapshot.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** PATCH /api/properties/:id/photos/:photoId: the alternative text. */
export const photoSchema = z
  .strictObject({ altEn: text(LISTING_LIMITS.alt), altDe: text(LISTING_LIMITS.alt) })
  .partial();

/** PUT /api/properties/:id/photos/order: every photo id, in the new order; the first is the cover. */
export const photoOrderSchema = z.strictObject({
  ids: z.array(z.uuid("must be photo ids")).min(1, "is required"),
});
