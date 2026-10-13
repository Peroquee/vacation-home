/**
 * Payment terms per property (GitLab #114): storage. Server-side only.
 */
import type { PaymentTerms as PaymentTermsRow } from "@/generated/prisma/client";
import { db, type DbClient } from "@/lib/db";

import type { PaymentTermsInput } from "./schema";
import { DEFAULT_TERMS, type PaymentTerms } from "./terms";

function toTerms(row: PaymentTermsRow | null): PaymentTerms {
  if (!row) return DEFAULT_TERMS;
  return {
    depositPercent: row.depositPercent,
    depositFixedMinor: row.depositFixedMinor,
    depositDueDays: row.depositDueDays,
    balanceDueDaysBefore: row.balanceDueDaysBefore,
    fullPaymentDueDays: row.fullPaymentDueDays,
  };
}

/** A property's terms; the defaults when it has none of its own. */
export async function getPaymentTerms(
  propertyId: string,
  client: DbClient = db,
): Promise<PaymentTerms> {
  return toTerms(await client.paymentTerms.findUnique({ where: { propertyId } }));
}

/** Terms for several properties at once, by property id. */
export async function getPaymentTermsFor(
  propertyIds: string[],
): Promise<Map<string, PaymentTerms>> {
  const rows = await db.paymentTerms.findMany({ where: { propertyId: { in: propertyIds } } });
  const byProperty = new Map(rows.map((row) => [row.propertyId, toTerms(row)]));
  return new Map(propertyIds.map((id) => [id, byProperty.get(id) ?? DEFAULT_TERMS]));
}

/** Replaces a property's terms. Bookings already reserved keep theirs. */
export async function savePaymentTerms(
  propertyId: string,
  input: PaymentTermsInput,
): Promise<PaymentTerms> {
  const row = await db.paymentTerms.upsert({
    where: { propertyId },
    create: { propertyId, ...input },
    update: input,
  });
  return toTerms(row);
}
