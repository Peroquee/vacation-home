/**
 * Input validation for properties. Shared by the API and, later, the
 * property settings form, so both reject the same things with the same
 * messages.
 */
import { z } from "zod";

/** The brand teal: the colour a property gets unless one is chosen. */
export const DEFAULT_PROPERTY_COLOR = "#0f766e";

/** Upper bound for a default rate or fee, in minor units: 1,000,000.00. */
const MAX_AMOUNT_MINOR = 100_000_000;

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const currencies = new Set(Intl.supportedValuesOf("currency"));

const amountMinor = z
  .int({ error: "must be a whole number of minor units (cents)" })
  .min(0, "cannot be negative")
  .max(MAX_AMOUNT_MINOR, "is too large");

const fields = {
  name: z.string().trim().min(1, "is required").max(100, "must be at most 100 characters"),
  address: z
    .string()
    .trim()
    .max(500, "must be at most 500 characters")
    .nullable()
    // A blank address means none.
    .transform((value) => value || null),
  timezone: z.string().trim().refine(isTimeZone, "must be an IANA timezone, e.g. Europe/Lisbon"),
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
};

/** POST /api/properties. Unknown fields are rejected rather than ignored. */
export const createPropertySchema = z.strictObject({
  name: fields.name,
  address: fields.address.optional(),
  timezone: fields.timezone,
  currency: fields.currency,
  defaultNightlyRateMinor: fields.defaultNightlyRateMinor.default(0),
  defaultCleaningFeeMinor: fields.defaultCleaningFeeMinor.default(0),
  color: fields.color.default(DEFAULT_PROPERTY_COLOR),
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
  })
  .partial()
  .refine((update) => Object.keys(update).length > 0, "at least one field is required");

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;
