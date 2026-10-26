/**
 * Reading and saving the legal pages (GitLab #112). Server-side only.
 *
 * The go-live gate lives in the database
 * (prisma/migrations/20261017010000_legal_pages): no property is listed
 * while the required parts are missing, and they cannot be emptied while
 * one is listed. The services ask first, for a clear answer, and the
 * triggers settle a race.
 */
import "server-only";

import type { SiteLegal } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { raisedByDatabase } from "@/lib/db-errors";

import { EMPTY_LEGAL, type Legal, legalComplete, REQUIRED } from "./legal";
import type { LegalInput } from "./schema";

const toLegal = (row: SiteLegal | null): Legal =>
  row
    ? {
        imprintName: row.imprintName,
        imprintAddress: row.imprintAddress,
        imprintEmail: row.imprintEmail,
        imprintPhone: row.imprintPhone,
        imprintVatId: row.imprintVatId,
        imprintExtra: row.imprintExtra,
        privacyPolicyDe: row.privacyPolicyDe,
        privacyPolicyEn: row.privacyPolicyEn,
      }
    : EMPTY_LEGAL;

export async function getLegal(): Promise<Legal> {
  return toLegal(await db.siteLegal.findUnique({ where: { id: 1 } }));
}

export async function isLegalComplete(): Promise<boolean> {
  return legalComplete(await getLegal());
}

export type SaveLegalResult = { legal: Legal } | { error: "in_use"; fields: string[] };

/**
 * Replaces the legal pages. Refused, naming the fields, when it would empty
 * a required part while a property is listed.
 */
export async function saveLegal(input: LegalInput): Promise<SaveLegalResult> {
  const missing = REQUIRED.filter((key) => input[key] === null);
  const refused = { error: "in_use" as const, fields: missing };
  if (missing.length > 0 && (await db.property.count({ where: { publiclyListed: true } })) > 0) {
    return refused;
  }
  try {
    const row = await db.siteLegal.upsert({
      where: { id: 1 },
      create: { id: 1, ...input },
      update: input,
    });
    return { legal: toLegal(row) };
  } catch (error) {
    if (raisedByDatabase(error, "legal_in_use")) return refused;
    throw error;
  }
}
