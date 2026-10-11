/**
 * Validation of the listing profile and photo details (GitLab #106). The
 * database checks the counts and times too
 * (prisma/migrations/20261011030000_listing_profile).
 */
import { z } from "zod";

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

/** PUT /api/properties/:id/listing: the whole profile; missing fields are blank. */
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
  checkInTime: time,
  checkOutTime: time,
});
export type ListingInput = z.infer<typeof listingSchema>;

/** PATCH /api/properties/:id/photos/:photoId: the alternative text. */
export const photoSchema = z
  .strictObject({ altEn: text(LISTING_LIMITS.alt), altDe: text(LISTING_LIMITS.alt) })
  .partial();

/** PUT /api/properties/:id/photos/order: every photo id, in the new order; the first is the cover. */
export const photoOrderSchema = z.strictObject({
  ids: z.array(z.uuid("must be photo ids")).min(1, "is required"),
});
