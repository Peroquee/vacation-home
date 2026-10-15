/**
 * Where guests transfer to, per property (GitLab #115). Server-side only.
 */
import { z } from "zod";

import type { BankDetails as Row } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { isValidBic, isValidIban, normaliseIban } from "./iban";

export type BankDetails = {
  accountHolder: string;
  iban: string;
  bic: string | null;
  bankName: string | null;
};

/** PUT /api/properties/:id/bank-details; the database checks the same. */
export const bankDetailsSchema = z.strictObject({
  accountHolder: z.string().trim().min(1, "is required").max(70, "must be at most 70 characters"),
  iban: z
    .string()
    .transform(normaliseIban)
    .refine(isValidIban, "must be a valid IBAN, e.g. DE89 3704 0044 0532 0130 00"),
  bic: z
    .string()
    .transform((value) => value.replace(/\s+/g, "").toUpperCase())
    .refine((value) => value === "" || isValidBic(value), "must be a BIC of 8 or 11 characters")
    .nullable()
    .optional()
    .transform((value) => value || null),
  bankName: z
    .string()
    .trim()
    .max(100, "must be at most 100 characters")
    .nullable()
    .optional()
    .transform((value) => value || null),
});

const toDetails = (row: Row): BankDetails => ({
  accountHolder: row.accountHolder,
  iban: row.iban,
  bic: row.bic,
  bankName: row.bankName,
});

/** The property's bank details, or null until the owner has entered them. */
export async function getBankDetails(propertyId: string): Promise<BankDetails | null> {
  const row = await db.bankDetails.findUnique({ where: { propertyId } });
  return row && toDetails(row);
}

export async function getBankDetailsFor(
  propertyIds: string[],
): Promise<Map<string, BankDetails | null>> {
  const rows = await db.bankDetails.findMany({ where: { propertyId: { in: propertyIds } } });
  const byProperty = new Map(rows.map((row) => [row.propertyId, toDetails(row)]));
  return new Map(propertyIds.map((id) => [id, byProperty.get(id) ?? null]));
}

export async function saveBankDetails(
  propertyId: string,
  input: z.infer<typeof bankDetailsSchema>,
): Promise<BankDetails> {
  return toDetails(
    await db.bankDetails.upsert({
      where: { propertyId },
      create: { propertyId, ...input },
      update: input,
    }),
  );
}
