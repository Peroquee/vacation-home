import { describe, expect, it } from "vitest";

import { newRulePrefill } from "./rule-prefill";

const PROPERTY = "6f1c2a52-6f0c-4c4e-9d43-3a0e4f1b9a11";
const CATEGORY = "0b8e4f7e-6a1d-4f7b-9c55-2f8d7f3e0a22";

describe("newRulePrefill (GitLab #130)", () => {
  it("takes what the expense dialog sent", () => {
    expect(
      newRulePrefill({
        new: "1",
        propertyId: PROPERTY,
        categoryId: CATEGORY,
        amountMinor: "4500",
        date: "2026-10-21",
        description: "Internet",
      }),
    ).toEqual({
      propertyId: PROPERTY,
      categoryId: CATEGORY,
      amountMinor: 4500,
      startDate: "2026-10-21",
      description: "Internet",
    });
  });

  it("leaves out what is not valid, for the form to ask", () => {
    expect(
      newRulePrefill({
        propertyId: "lake",
        categoryId: ["a", "b"],
        amountMinor: "-3",
        date: "2026-02-30",
        description: "x".repeat(600),
      }),
    ).toEqual({
      propertyId: undefined,
      categoryId: "",
      amountMinor: undefined,
      startDate: undefined,
      description: "x".repeat(500),
    });
    expect(newRulePrefill({ amountMinor: "12.5" }).amountMinor).toBeUndefined();
  });
});
