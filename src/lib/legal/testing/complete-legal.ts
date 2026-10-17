/**
 * Legal pages complete enough to list a property (GitLab #112), for the
 * database tests that list one.
 */
import { db } from "@/lib/db";

import type { Legal } from "../legal";

export const COMPLETE_LEGAL: Legal = {
  imprintName: "Ada Owner",
  imprintAddress: "Seestraße 1\n12345 Seedorf",
  imprintEmail: "owner@example.test",
  imprintPhone: null,
  imprintVatId: null,
  imprintExtra: null,
  privacyPolicyDe: "## Datenschutz\n\nText.",
  privacyPolicyEn: "## Privacy\n\nText.",
};

export async function fillLegal(): Promise<void> {
  await db.siteLegal.upsert({
    where: { id: 1 },
    create: { id: 1, ...COMPLETE_LEGAL },
    update: COMPLETE_LEGAL,
  });
}
