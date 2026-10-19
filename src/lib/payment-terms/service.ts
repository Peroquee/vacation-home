/**
 * Payment terms per property (GitLab #114): storage. Server-side only.
 */
import { Prisma, type PaymentTerms as PaymentTermsRow } from "@/generated/prisma/client";
import type { RefundSchedule } from "@/lib/cancellation/policy";
import { db, type DbClient } from "@/lib/db";

import { parseSchedule, type PaymentTermsInput } from "./schema";
import { DEFAULT_TERMS, type PaymentTerms } from "./terms";

function toTerms(row: PaymentTermsRow | null): PaymentTerms {
  if (!row) return DEFAULT_TERMS;
  return {
    depositPercent: row.depositPercent,
    depositFixedMinor: row.depositFixedMinor,
    depositDueDays: row.depositDueDays,
    balanceDueDaysBefore: row.balanceDueDaysBefore,
    fullPaymentDueDays: row.fullPaymentDueDays,
    depositNonRefundable: row.depositNonRefundable,
    refundSchedule: parseSchedule(row.refundSchedule),
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

/**
 * Replaces a property's terms; `depositNonRefundable` left out stays as it
 * was. Bookings already reserved keep theirs, and their cancellation policy.
 */
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

/**
 * Replaces a property's refund schedule (GitLab #123), or removes it with
 * null; terms of its own are created from the defaults where it had none.
 * Bookings keep the schedule they were requested under.
 */
export async function saveRefundSchedule(
  propertyId: string,
  schedule: RefundSchedule | null,
): Promise<PaymentTerms> {
  const value = schedule ?? Prisma.DbNull;
  const row = await db.paymentTerms.upsert({
    where: { propertyId },
    create: {
      propertyId,
      depositPercent: DEFAULT_TERMS.depositPercent,
      depositFixedMinor: DEFAULT_TERMS.depositFixedMinor,
      depositDueDays: DEFAULT_TERMS.depositDueDays,
      balanceDueDaysBefore: DEFAULT_TERMS.balanceDueDaysBefore,
      fullPaymentDueDays: DEFAULT_TERMS.fullPaymentDueDays,
      depositNonRefundable: DEFAULT_TERMS.depositNonRefundable,
      refundSchedule: value,
    },
    update: { refundSchedule: value },
  });
  return toTerms(row);
}
