/** Input validation for guests, shared by the API and the booking form. */
import { z } from "zod";

/** Blank means "none", for the optional text fields. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `must be at most ${max} characters`)
    .nullable()
    .transform((value) => value || null);

const fields = {
  name: z.string().trim().min(1, "is required").max(200, "must be at most 200 characters"),
  // Trimmed and lower-cased before it is checked or stored, so the same
  // address in any case is the same guest.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.union([z.literal(""), z.email("must be a valid email address")]))
    .nullable()
    .transform((value) => value || null),
  phone: optionalText(50).refine(
    (value) => value === null || /^[0-9+()\-.\s/]+$/.test(value),
    "may contain only digits, spaces and + ( ) - . /",
  ),
  notes: optionalText(2000),
};

/** The fields one by one, for forms that collect a guest's details too. */
export { fields as guestFields };

export const createGuestSchema = z.strictObject({
  name: fields.name,
  email: fields.email.optional(),
  phone: fields.phone.optional(),
  notes: fields.notes.optional(),
});

export const updateGuestSchema = z
  .strictObject(fields)
  .partial()
  .refine((update) => Object.keys(update).length > 0, "at least one field is required");

export const searchGuestsSchema = z.object({
  q: z.string().trim().max(200).optional(),
  // `?limit=` with no value means the default, not zero.
  limit: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(1).max(100).default(20),
  ),
});

export type CreateGuestInput = z.infer<typeof createGuestSchema>;
export type UpdateGuestInput = z.infer<typeof updateGuestSchema>;
