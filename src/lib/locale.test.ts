import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE, resolveAppLocale } from "@/lib/locale";

describe("resolveAppLocale", () => {
  it("defaults when unset or blank", () => {
    expect(resolveAppLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveAppLocale("  ")).toBe(DEFAULT_LOCALE);
  });

  it("canonicalises a supported tag, ignoring surrounding whitespace", () => {
    expect(resolveAppLocale(" de-de ")).toBe("de-DE");
  });

  it("rejects malformed and unsupported tags", () => {
    expect(() => resolveAppLocale("en_US")).toThrow(RangeError);
    // Well-formed, but no runtime formats in them: Intl would fall back.
    expect(() => resolveAppLocale("english")).toThrow(RangeError);
    expect(() => resolveAppLocale("zz-ZZ")).toThrow(RangeError);
  });
});
