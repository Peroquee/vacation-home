/**
 * The public site's legal pages (GitLab #112): the Impressum (§ 5 DDG) and
 * the privacy policy (Art. 13 GDPR), one set for the whole site. The owner
 * writes them in settings; the public site cannot go live without them.
 * Client-safe, and light: no validation library, which would weigh down
 * the settings bundle (the schema is in ./schema.ts).
 */

export const LEGAL_LIMITS = { line: 200, address: 500, extra: 5_000, policy: 50_000 } as const;

/** Refused when listing a property before the legal pages are filled in. */
export const LEGAL_REQUIRED = "needs the imprint and privacy policy first";
/** Refused when emptying a required part while a property is listed. */
export const LEGAL_IN_USE = "is required while a property is listed";

/**
 * Leads the privacy policy template. Left in, the settings checklist warns
 * that the text has not been checked yet; the gate does not wait for it.
 */
export const TEMPLATE_MARKER = "<!-- template -->";

export type Legal = {
  imprintName: string | null;
  imprintAddress: string | null;
  imprintEmail: string | null;
  imprintPhone: string | null;
  imprintVatId: string | null;
  /** Markdown. */
  imprintExtra: string | null;
  /** Markdown, per language. */
  privacyPolicyDe: string | null;
  privacyPolicyEn: string | null;
};

export const EMPTY_LEGAL: Legal = {
  imprintName: null,
  imprintAddress: null,
  imprintEmail: null,
  imprintPhone: null,
  imprintVatId: null,
  imprintExtra: null,
  privacyPolicyDe: null,
  privacyPolicyEn: null,
};

/** What the public site cannot go live without; the database checks the same. */
export const REQUIRED = [
  "imprintName",
  "imprintAddress",
  "imprintEmail",
  "privacyPolicyDe",
  "privacyPolicyEn",
] as const satisfies (keyof Legal)[];

export const legalComplete = (legal: Legal) => REQUIRED.every((key) => legal[key] !== null);

export const imprintComplete = (legal: Legal) =>
  legal.imprintName !== null && legal.imprintAddress !== null && legal.imprintEmail !== null;

/** The privacy policy still starts with the template's note. */
export const policyUnchecked = (legal: Legal) =>
  [legal.privacyPolicyDe, legal.privacyPolicyEn].some((text) => text?.includes(TEMPLATE_MARKER));

/** The privacy policy in `locale`, falling back to the other language. */
export const policyFor = (legal: Legal, locale: string) =>
  locale.startsWith("de")
    ? (legal.privacyPolicyDe ?? legal.privacyPolicyEn)
    : (legal.privacyPolicyEn ?? legal.privacyPolicyDe);
