import { describe, expect, it } from "vitest";

import { canonicalTimeZone } from "./schema";
import { currencyOptions, inputToMinor, minorDigits, minorToInput, timeZoneOptions } from "./form";

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
