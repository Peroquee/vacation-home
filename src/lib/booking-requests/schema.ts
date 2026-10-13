/** Input validation for booking requests from the public site (GitLab #109). */
import { z } from "zod";

import { LOCALES } from "@/i18n/locales";
import { stayQuerySchema } from "@/lib/booking-rules/schema";
import { guestFields } from "@/lib/guests/schema";

import { challengePayloadSchema } from "./challenge";
import { MESSAGE_MAX } from "./values";

/**
 * POST /api/public/properties/:slug/requests. Only what the owner needs to
 * answer (data minimisation): the stay, who and how many, and a message.
 * The honeypot field is judged before this, by the route.
 */
export const bookingRequestSchema = z
  .strictObject({
    checkIn: stayQuerySchema.shape.checkIn,
    checkOut: stayQuerySchema.shape.checkOut,
    guestCount: z.int("must be a whole number").min(1, "must be at least 1").max(50, "is too many"),
    name: guestFields.name,
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "is required")
      .pipe(z.email("must be a valid email address")),
    phone: guestFields.phone.optional(),
    message: z
      .string()
      .trim()
      .max(MESSAGE_MAX, `must be at most ${MESSAGE_MAX} characters`)
      .transform((value) => value || null)
      .optional(),
    consent: z.literal(true, { error: "must be accepted to send the request" }),
    locale: z.enum(LOCALES),
    homepage: z.string().optional(),
    altcha: challengePayloadSchema,
  })
  .superRefine((stay, context) => {
    // The same check-in/check-out rule as everywhere else.
    const result = stayQuerySchema.safeParse({ checkIn: stay.checkIn, checkOut: stay.checkOut });
    for (const issue of result.error?.issues ?? []) {
      if (issue.path[0] === "checkOut") {
        context.addIssue({ code: "custom", path: ["checkOut"], message: issue.message });
      }
    }
  });

export type BookingRequestInput = z.infer<typeof bookingRequestSchema>;
