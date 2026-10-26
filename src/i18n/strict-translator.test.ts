/**
 * The component tests' translator (vitest.translator.ts, GitLab #146): a
 * missing translation fails the test instead of rendering "ns.key".
 */
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import { strictTranslator } from "../../vitest.translator";

const english = { page: { hello: "Hello {name}", both: "Both", onlyEnglish: "Only English" } };
const german = { page: { hello: "Hallo {name}", both: "Beide" } };
const t = strictTranslator(createTranslator, english, german, "page");

describe("the component tests' translator", () => {
  it("translates in English what both languages have", () => {
    expect(t("hello", { name: "Ada" })).toBe("Hello Ada");
    expect(t("both")).toBe("Both");
    expect(t.has("both")).toBe(true);
  });

  it("fails on a key missing in English", () => {
    expect(() => t("nowhere")).toThrow(/MISSING_MESSAGE/);
  });

  it("fails on a key missing in German, though English has it", () => {
    expect(() => t("onlyEnglish")).toThrow("MISSING_MESSAGE: page.onlyEnglish (de-DE)");
    expect(() => t.rich("onlyEnglish")).toThrow(/de-DE/);
  });

  it("fails on a message given the wrong values", () => {
    expect(() => t("hello")).toThrow(/FORMATTING_ERROR/);
  });
});
