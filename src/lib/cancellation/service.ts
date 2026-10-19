/**
 * The cancellation policy a booking is under (GitLab #116): a snapshot of
 * the property's at the time the guest agreed, so a later change to the
 * terms never changes an existing booking. Reserving keeps its
 * `depositNonRefundable` and sets the deposit to the one the guest is then
 * asked for (src/lib/bookings/hold.ts). Server-side only.
 */
import type { Prisma } from "@/generated/prisma/client";
import { db, type DbClient } from "@/lib/db";
import { getPaymentTerms } from "@/lib/payment-terms/service";
import { depositFor } from "@/lib/payment-terms/terms";

import type { CancellationTerms } from "./policy";
import { parseSnapshot } from "./schema";

/** The property's policy now, for a booking of `totalMinor`. */
export async function currentTerms(
  propertyId: string,
  totalMinor: number,
  client: DbClient = db,
): Promise<CancellationTerms> {
  const terms = await getPaymentTerms(propertyId, client);
  return {
    depositNonRefundable: terms.depositNonRefundable,
    depositAmountMinor: depositFor(totalMinor, terms),
    schedule: terms.refundSchedule,
  };
}

/** The same, to keep on the booking. */
export async function policySnapshot(
  propertyId: string,
  totalMinor: number,
  client: DbClient = db,
): Promise<Prisma.InputJsonObject> {
  return { ...(await currentTerms(propertyId, totalMinor, client)) };
}

/** The policy a booking is under: its snapshot, else the property's now. */
export async function bookingPolicy(
  booking: {
    propertyId: string;
    totalAmountMinor: number;
    touristTaxMinor?: number;
    cancellationPolicy: unknown;
  },
  client: DbClient = db,
): Promise<CancellationTerms> {
  return (
    parseSnapshot(booking.cancellationPolicy) ??
    (await currentTerms(
      booking.propertyId,
      booking.totalAmountMinor - (booking.touristTaxMinor ?? 0),
      client,
    ))
  );
}
