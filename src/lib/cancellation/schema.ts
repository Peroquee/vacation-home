/**
 * Validation of a cancellation (POST /api/bookings/:id/cancel), and the
 * policy kept on a booking, read back (GitLab #116).
 */
import { z } from "zod";

import { MAX_AMOUNT_MINOR } from "@/lib/bookings/pricing";

import type { CancellationTerms } from "./policy";

/**
 * Without a body the owner cancels. A `refundMinor` overrides what the
 * policy (or, for the owner, the full refund) would pay back.
 */
export const cancelSchema = z.strictObject({
  by: z.enum(["guest", "owner"]).default("owner"),
  refundMinor: z
    .int({ error: "must be a whole number of minor units (cents)" })
    .min(0, "cannot be negative")
    .max(MAX_AMOUNT_MINOR, "is too large")
    .optional(),
});

export type CancelInput = z.infer<typeof cancelSchema>;

const snapshotSchema = z.object({
  depositNonRefundable: z.boolean(),
  depositAmountMinor: z.int().min(0),
});

/** A stored snapshot, read back defensively: null when it is not one. */
export function parseSnapshot(value: unknown): CancellationTerms | null {
  const result = snapshotSchema.safeParse(value);
  return result.success ? result.data : null;
}
