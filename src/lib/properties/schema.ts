/**
 * Input validation for properties. Shared by the API and, later, the
 * property settings form, so both reject the same things with the same
 * messages.
 */
import { z } from "zod";

import { DEFAULT_PROPERTY_COLOR } from "./values";

export { DEFAULT_PROPERTY_COLOR };

/** Upper bound for a default rate or fee, in minor units: 1,000,000.00. */
const MAX_AMOUNT_MINOR = 100_000_000;

/**
 * The canonical IANA name for a zone ("europe/lisbon" -> "Europe/Lisbon",
 * "US/Eastern" -> "America/New_York"), or null. Bare UTC offsets such as
 * "+05:30" are refused: Intl accepts them, but they are not IANA zones, have
 * no daylight-saving rules, and PostgreSQL reads their sign the other way.
 */
export function canonicalTimeZone(value: string): string | null {
  try {
    const zone = new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
    return /^[+-]/.test(zone) ? null : zone;
  } catch {
    return null;
  }
}

const currencies = new Set(Intl.supportedValuesOf("currency"));

const amountMinor = z
  .int({ error: "must be a whole number of minor units (cents)" })
  .min(0, "cannot be negative")
  .max(MAX_AMOUNT_MINOR, "is too large");

/**
 * The property's part of its public URL (/stay/<slug>); the database checks
 * the same (prisma/migrations/20261011010000_public_listing).
 */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const SLUG_FORMAT =
  "must be 3 to 60 lowercase letters, digits and single hyphens, e.g. lake-house";
export const SLUG_REQUIRED = "needs a web address (slug) first";
export const SLUG_TAKEN = "is already used by another property";
export const SLUG_RESERVED = "is reserved for the site's own pages";
/** Paths of the public site itself (/stay/legal/...), never a property's. */
export const RESERVED_SLUGS: readonly string[] = ["legal"];

const fields = {
  name: z.string().trim().min(1, "is required").max(100, "must be at most 100 characters"),
  address: z
    .string()
    .trim()
    .max(500, "must be at most 500 characters")
    .nullable()
    // A blank address means none.
    .transform((value) => value || null),
  timezone: z
    .string()
    .trim()
    .transform((value, context) => {
      const zone = canonicalTimeZone(value);
      if (zone) return zone;
      context.addIssue({ code: "custom", message: "must be an IANA timezone, e.g. Europe/Lisbon" });
      return z.NEVER;
    }),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .refine((code) => /^[A-Z]{3}$/.test(code) && currencies.has(code), {
      error: "must be an ISO 4217 currency code, e.g. EUR",
    }),
  defaultNightlyRateMinor: amountMinor,
  defaultCleaningFeeMinor: amountMinor,
  color: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^#[0-9a-f]{6}$/, "must be a hex colour like #0f766e"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .refine((slug) => slug === "" || (SLUG.test(slug) && slug.length >= 3 && slug.length <= 60), {
      error: SLUG_FORMAT,
    })
    .refine((slug) => !RESERVED_SLUGS.includes(slug), { error: SLUG_RESERVED })
    .nullable()
    // A blank slug means none.
    .transform((value) => value || null),
  publiclyListed: z.boolean({ error: "must be true or false" }),
};

/** POST /api/properties. Unknown fields are rejected rather than ignored. */
export const createPropertySchema = z
  .strictObject({
    name: fields.name,
    address: fields.address.optional(),
    timezone: fields.timezone,
    currency: fields.currency,
    defaultNightlyRateMinor: fields.defaultNightlyRateMinor.default(0),
    defaultCleaningFeeMinor: fields.defaultCleaningFeeMinor.default(0),
    color: fields.color.default(DEFAULT_PROPERTY_COLOR),
    slug: fields.slug.optional(),
    publiclyListed: fields.publiclyListed.default(false),
  })
  .refine((property) => !property.publiclyListed || property.slug, {
    path: ["publiclyListed"],
    error: SLUG_REQUIRED,
  });

/** PATCH /api/properties/:id. Any subset of fields, but at least one. */
export const updatePropertySchema = z
  .strictObject({
    name: fields.name,
    address: fields.address,
    timezone: fields.timezone,
    currency: fields.currency,
    defaultNightlyRateMinor: fields.defaultNightlyRateMinor,
    defaultCleaningFeeMinor: fields.defaultCleaningFeeMinor,
    color: fields.color,
    slug: fields.slug,
    publiclyListed: fields.publiclyListed,
  })
  .partial()
  .refine((update) => Object.keys(update).length > 0, "at least one field is required")
  // Judged against the stored slug too, by the service.
  .refine((update) => !(update.publiclyListed && update.slug === null), {
    path: ["publiclyListed"],
    error: SLUG_REQUIRED,
  });

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;
