/** Validation of the legal pages (GitLab #112). Server-side: the API's. */
import { z } from "zod";

import { LEGAL_LIMITS } from "./legal";

// Blank means not given, and is stored as null.
const text = (max: number) =>
  z
    .string()
    .max(max, `must be at most ${max} characters`)
    .nullable()
    .default(null)
    .transform((value) => value?.trim() || null);

/** PUT /api/legal: the whole set; missing fields are blank. */
export const legalSchema = z.strictObject({
  imprintName: text(LEGAL_LIMITS.line),
  imprintAddress: text(LEGAL_LIMITS.address),
  imprintEmail: text(LEGAL_LIMITS.line).pipe(
    z.union([z.null(), z.email("must be a valid email address")]),
  ),
  imprintPhone: text(LEGAL_LIMITS.line),
  imprintVatId: text(LEGAL_LIMITS.line),
  imprintExtra: text(LEGAL_LIMITS.extra),
  privacyPolicyDe: text(LEGAL_LIMITS.policy),
  privacyPolicyEn: text(LEGAL_LIMITS.policy),
});
export type LegalInput = z.infer<typeof legalSchema>;
