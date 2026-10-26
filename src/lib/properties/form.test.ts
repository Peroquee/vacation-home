import { describe, expect, it } from "vitest";

import { canonicalTimeZone } from "./schema";
import {
  amountExamples,
  currencyOptions,
  inputToMinor,
  minorDigits,
  minorToInput,
  timeZoneOptions,
} from "./form";

describe("minorDigits", () => {
  it("comes from the currency", () => {
    expect(minorDigits("EUR")).toBe(2);
    expect(minorDigits("JPY")).toBe(0);
    expect(minorDigits("KWD")).toBe(3);
  });
});

describe("minorToInput", () => {
  it("places the decimal point by the currency's minor digits", () => {
    expect(minorToInput(18000, "EUR")).toBe("180.00");
    expect(minorToInput(5, "EUR")).toBe("0.05");
    expect(minorToInput(0, "EUR")).toBe("0.00");
    expect(minorToInput(1500, "JPY")).toBe("1500");
    expect(minorToInput(1234, "KWD")).toBe("1.234");
  });
});

describe("inputToMinor", () => {
  it("reads whole and fractional amounts without floats", () => {
    expect(inputToMinor("180", "EUR")).toBe(18000);
    expect(inputToMinor("180.5", "EUR")).toBe(18050);
    expect(inputToMinor("0.29", "EUR")).toBe(29); // 0.29 * 100 is 28.999… as a float
    expect(inputToMinor(" 180,50 ", "EUR")).toBe(18050);
    expect(inputToMinor("1500", "JPY")).toBe(1500);
  });

  it("treats a blank input as zero", () => {
    expect(inputToMinor("", "EUR")).toBe(0);
    expect(inputToMinor("  ", "EUR")).toBe(0);
  });

  it("refuses what it would otherwise have to round or guess", () => {
    expect(inputToMinor("1.234", "EUR")).toBeNull();
    expect(inputToMinor("1.5", "JPY")).toBeNull();
    expect(inputToMinor("-5", "EUR")).toBeNull();
    expect(inputToMinor("1e3", "EUR")).toBeNull();
    expect(inputToMinor("1,000.00", "EUR")).toBeNull();
    expect(inputToMinor("abc", "EUR")).toBeNull();
  });

  it("round-trips with minorToInput", () => {
    for (const [minor, currency] of [
      [18050, "EUR"],
      [7, "EUR"],
      [1500, "JPY"],
      [1234, "KWD"],
    ] as const) {
      expect(inputToMinor(minorToInput(minor, currency), currency)).toBe(minor);
    }
  });
});

describe("options", () => {
  it("offers only timezones the API accepts", () => {
    const zones = timeZoneOptions();
    expect(zones).toContain("Europe/Lisbon");
    expect(zones.filter((zone) => canonicalTimeZone(zone) === null)).toEqual([]);
  });

  it("names currencies", () => {
    expect(currencyOptions()).toContainEqual({ code: "EUR", name: "Euro" });
  });
});

describe("amountExamples", () => {
  it("shows both decimal marks, or one for a currency without minor units", () => {
    expect(amountExamples("EUR")).toEqual(["1000.50", "1000,50"]);
    expect(amountExamples("JPY")).toEqual(["100050"]);
  });

  it("describes what inputToMinor accepts", () => {
    expect(inputToMinor("1000,50", "EUR")).toBe(100050);
    expect(inputToMinor("1.000,50", "EUR")).toBeNull();
  });
});

describe("amounts in German (GitLab #139)", () => {
  it("are read with a decimal comma, thousands points, or a decimal point", () => {
    expect(inputToMinor("12,50", "EUR", "de-DE")).toBe(1250);
    expect(inputToMinor("1.234,56", "EUR", "de-DE")).toBe(123456);
    expect(inputToMinor("1.234", "EUR", "de-DE")).toBe(123400);
    expect(inputToMinor("1.234.567,8", "EUR", "de-DE")).toBe(123456780);
    expect(inputToMinor("12.50", "EUR", "de-DE")).toBe(1250);
    expect(inputToMinor("1.500", "JPY", "de-DE")).toBe(1500);
  });

  it("refuse what they would have to guess or round", () => {
    expect(inputToMinor("1,234", "EUR", "de-DE")).toBeNull();
    expect(inputToMinor("12.5.0", "EUR", "de-DE")).toBeNull();
    expect(inputToMinor("1.23,4", "EUR", "de-DE")).toBeNull();
    expect(inputToMinor("-5", "EUR", "de-DE")).toBeNull();
    // Three minor digits: the point is the decimal mark, not a thousands group.
    expect(inputToMinor("1.234", "KWD", "de-DE")).toBe(1234);
  });

  it("are shown with a decimal comma, and read back", () => {
    expect(minorToInput(18000, "EUR", "de-DE")).toBe("180,00");
    expect(minorToInput(1500, "JPY", "de-DE")).toBe("1500");
    for (const [minor, currency] of [
      [18050, "EUR"],
      [7, "EUR"],
      [1500, "JPY"],
      [1234, "KWD"],
    ] as const) {
      expect(inputToMinor(minorToInput(minor, currency, "de-DE"), currency, "de-DE")).toBe(minor);
    }
  });

  it("are described with German examples", () => {
    expect(amountExamples("EUR", "de-DE")).toEqual(["1000,50", "1.000,50"]);
    expect(amountExamples("JPY", "de-DE")).toEqual(["100050"]);
  });

  it("leave English unchanged", () => {
    expect(inputToMinor("12.50", "EUR", "en-GB")).toBe(1250);
    expect(inputToMinor("12,50", "EUR", "en-GB")).toBe(1250);
    expect(inputToMinor("1.234", "EUR", "en-GB")).toBeNull();
    expect(inputToMinor("1,000.00", "EUR", "en-GB")).toBeNull();
    expect(minorToInput(18000, "EUR", "en-GB")).toBe("180.00");
    expect(amountExamples("EUR", "en-GB")).toEqual(["1000.50", "1000,50"]);
  });
});
