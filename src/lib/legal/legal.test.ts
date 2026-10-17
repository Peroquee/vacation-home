import { describe, expect, it } from "vitest";

import {
  EMPTY_LEGAL,
  imprintComplete,
  legalComplete,
  policyFor,
  policyUnchecked,
  TEMPLATE_MARKER,
} from "./legal";
import { legalSchema } from "./schema";
import { COMPLETE_LEGAL } from "./testing/complete-legal";

describe("the legal pages' input", () => {
  it("trims, stores blanks as nothing, and fills missing fields in as blank", () => {
    expect(legalSchema.parse({ imprintName: "  Ada ", imprintPhone: "  " })).toEqual({
      ...EMPTY_LEGAL,
      imprintName: "Ada",
    });
  });

  it("needs a valid email when one is given", () => {
    expect(legalSchema.safeParse({ imprintEmail: "nope" }).success).toBe(false);
    expect(legalSchema.parse({ imprintEmail: " a@b.test " }).imprintEmail).toBe("a@b.test");
    expect(legalSchema.parse({ imprintEmail: "" }).imprintEmail).toBeNull();
  });

  it("refuses unknown fields and overlong text", () => {
    expect(legalSchema.safeParse({ owner: "x" }).success).toBe(false);
    expect(legalSchema.safeParse({ imprintName: "x".repeat(201) }).success).toBe(false);
  });
});

describe("whether the public site can go live", () => {
  it("needs name, address, email and the policy in both languages", () => {
    expect(legalComplete(COMPLETE_LEGAL)).toBe(true);
    expect(legalComplete(EMPTY_LEGAL)).toBe(false);
    expect(legalComplete({ ...COMPLETE_LEGAL, privacyPolicyEn: null })).toBe(false);
    expect(legalComplete({ ...COMPLETE_LEGAL, imprintAddress: null })).toBe(false);
    expect(imprintComplete({ ...COMPLETE_LEGAL, privacyPolicyDe: null })).toBe(true);
  });

  it("does not need phone, VAT ID or the addition", () => {
    expect(
      legalComplete({
        ...COMPLETE_LEGAL,
        imprintPhone: null,
        imprintVatId: null,
        imprintExtra: null,
      }),
    ).toBe(true);
  });

  it("notices the template's note left in", () => {
    expect(policyUnchecked(COMPLETE_LEGAL)).toBe(false);
    expect(policyUnchecked({ ...COMPLETE_LEGAL, privacyPolicyEn: `${TEMPLATE_MARKER}\n> x` })).toBe(
      true,
    );
  });
});

describe("the privacy policy shown", () => {
  it("is the visitor's language, else the other", () => {
    expect(policyFor(COMPLETE_LEGAL, "de-DE")).toBe(COMPLETE_LEGAL.privacyPolicyDe);
    expect(policyFor(COMPLETE_LEGAL, "en-GB")).toBe(COMPLETE_LEGAL.privacyPolicyEn);
    expect(policyFor({ ...COMPLETE_LEGAL, privacyPolicyEn: null }, "en-GB")).toBe(
      COMPLETE_LEGAL.privacyPolicyDe,
    );
    expect(policyFor(EMPTY_LEGAL, "de-DE")).toBeNull();
  });
});
