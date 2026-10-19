import { describe, expect, it } from "vitest";

import { MAX_AMOUNT_MINOR } from "@/lib/bookings/pricing";

import { lowestRate, parseBreakdown, priceStay, type PricingRules, rateOn } from "./engine";
import { covers, isMonthDay, overlapping, seasonOn } from "./seasons";

const yearly = (
  name: string,
  start: [number, number],
  end: [number, number],
  rateMinor: number,
) => ({
  name,
  startMonth: start[0],
  startDay: start[1],
  endMonth: end[0],
  endDay: end[1],
  year: null,
  rateMinor,
});

const SUMMER = yearly("Hauptsaison", [7, 1], [8, 31], 9_500);
const WINTER = yearly("Winter", [12, 20], [1, 6], 11_000);
const EASTER_2027 = { ...yearly("Ostern", [3, 26], [4, 5], 12_000), year: 2027 };

const RULES: PricingRules = {
  currency: "EUR",
  defaultNightlyRateMinor: 7_000,
  defaultCleaningFeeMinor: 5_000,
  seasons: [SUMMER, WINTER, EASTER_2027],
  discounts: [],
  touristTax: null,
};

describe("which rate applies on a night", () => {
  it("is the season's inside it, both ends included, and the default outside", () => {
    expect(rateOn(RULES, "2027-06-30")).toBe(7_000);
    expect(rateOn(RULES, "2027-07-01")).toBe(9_500);
    expect(rateOn(RULES, "2027-08-31")).toBe(9_500);
    expect(rateOn(RULES, "2027-09-01")).toBe(7_000);
  });

  it("repeats a yearly season every year, also across New Year", () => {
    for (const date of ["2026-12-20", "2026-12-31", "2027-01-01", "2027-01-06", "2030-12-25"]) {
      expect(rateOn(RULES, date), date).toBe(11_000);
    }
    expect(rateOn(RULES, "2026-12-19")).toBe(7_000);
    expect(rateOn(RULES, "2027-01-07")).toBe(7_000);
  });

  it("applies a one-off season in its year only", () => {
    expect(rateOn(RULES, "2027-03-26")).toBe(12_000);
    expect(rateOn(RULES, "2028-03-26")).toBe(7_000);
    // Once, across New Year: the end falls in the next year.
    const silvester = { ...yearly("Silvester", [12, 28], [1, 2], 15_000), year: 2026 };
    expect(covers(silvester, "2027-01-02")).toBe(true);
    expect(covers(silvester, "2027-12-30")).toBe(false);
  });

  it("gives a one-off season priority over a yearly one it lies in", () => {
    const july = { ...yearly("Sommerfest", [7, 10], [7, 12], 13_000), year: 2027 };
    const rules = { ...RULES, seasons: [SUMMER, july] };
    expect(rateOn(rules, "2027-07-11")).toBe(13_000);
    expect(rateOn(rules, "2028-07-11")).toBe(9_500);
    expect(seasonOn(rules.seasons, "2027-07-13")?.name).toBe("Hauptsaison");
  });

  it("knows 29 February only in leap years, and a yearly season may name it", () => {
    expect(isMonthDay(2, 29)).toBe(true);
    expect(isMonthDay(2, 30)).toBe(false);
    expect(isMonthDay(4, 31)).toBe(false);
    expect(isMonthDay(13, 1)).toBe(false);
    const leap = yearly("Schalttag", [2, 29], [2, 29], 1);
    expect(covers(leap, "2028-02-29")).toBe(true);
    expect(covers(leap, "2027-03-01")).toBe(false);
  });
});

describe("overlapping seasons", () => {
  it("are refused between yearly ones, also across New Year", () => {
    expect(overlapping(yearly("Late summer", [8, 31], [9, 15], 1), [SUMMER])).toBe(SUMMER);
    expect(overlapping(yearly("January", [1, 6], [1, 31], 1), [WINTER])).toBe(WINTER);
    expect(overlapping(yearly("Autumn", [9, 1], [10, 31], 1), [SUMMER, WINTER])).toBeNull();
  });

  it("are refused between one-off ones, but a one-off may lie in a yearly one", () => {
    const other = { ...yearly("Ostern lang", [4, 5], [4, 10], 1), year: 2027 };
    expect(overlapping(other, [EASTER_2027])).toBe(EASTER_2027);
    expect(overlapping({ ...other, year: 2028 }, [EASTER_2027])).toBeNull();
    const july = { ...yearly("Fest", [7, 10], [7, 12], 1), year: 2027 };
    expect(overlapping(july, [SUMMER])).toBeNull();
  });

  it("leave a season alone against itself, when it is edited", () => {
    const stored = { ...SUMMER, id: "a" };
    expect(overlapping({ ...stored, endDay: 30 }, [stored])).toBeNull();
  });
});

describe("the price of a stay", () => {
  it("prices each night by its season, across a boundary, plus the cleaning fee", () => {
    // 28-30 Jun at the default rate, 1-2 Jul in the summer.
    expect(priceStay(RULES, { checkIn: "2027-06-28", checkOut: "2027-07-03" })).toEqual({
      version: 1,
      kind: "computed",
      currency: "EUR",
      nights: [
        { season: null, nights: 3, rateMinor: 7_000, amountMinor: 21_000 },
        { season: "Hauptsaison", nights: 2, rateMinor: 9_500, amountMinor: 19_000 },
      ],
      nightsMinor: 40_000,
      discount: null,
      cleaningFeeMinor: 5_000,
      touristTax: null,
      touristTaxRules: null,
      totalMinor: 45_000,
    });
  });

  it("charges the night before check-out, never check-out day itself", () => {
    // Leaving on 1 Jul: the last night is 30 Jun, at the default rate.
    expect(priceStay(RULES, { checkIn: "2027-06-29", checkOut: "2027-07-01" }).nights).toEqual([
      { season: null, nights: 2, rateMinor: 7_000, amountMinor: 14_000 },
    ]);
  });

  it("crosses New Year inside a repeating season", () => {
    const price = priceStay(RULES, { checkIn: "2026-12-30", checkOut: "2027-01-08" });
    expect(price.nights).toEqual([
      { season: "Winter", nights: 8, rateMinor: 11_000, amountMinor: 88_000 },
      { season: null, nights: 1, rateMinor: 7_000, amountMinor: 7_000 },
    ]);
  });

  it("uses a booking's own flat rate and cleaning fee when it has them", () => {
    const price = priceStay(RULES, {
      checkIn: "2027-06-28",
      checkOut: "2027-07-03",
      nightlyRateMinor: 8_000,
      cleaningFeeMinor: 0,
    });
    expect(price.nights).toEqual([
      { season: null, nights: 5, rateMinor: 8_000, amountMinor: 40_000 },
    ]);
    expect(price.totalMinor).toBe(40_000);
  });

  it("refuses what is not a stay, a bad amount, or a total too large to store", () => {
    expect(() => priceStay(RULES, { checkIn: "2027-07-02", checkOut: "2027-07-02" })).toThrow(
      RangeError,
    );
    expect(() =>
      priceStay(RULES, { checkIn: "2027-07-01", checkOut: "2027-07-02", nightlyRateMinor: 1.5 }),
    ).toThrow(RangeError);
    expect(() =>
      priceStay(
        { ...RULES, defaultNightlyRateMinor: MAX_AMOUNT_MINOR },
        { checkIn: "2027-09-01", checkOut: "2027-09-03" },
      ),
    ).toThrow(/largest storable/);
  });
});

describe("the public 'from' price", () => {
  it("is the lowest rate charged on any night of the next 12 months", () => {
    const cheap = { ...yearly("Nebensaison", [11, 1], [11, 30], 5_500) };
    expect(lowestRate({ ...RULES, seasons: [...RULES.seasons, cheap] }, "2027-01-15")).toBe(5_500);
    // A one-off season that is already over does not count.
    const past = { ...yearly("Damals", [2, 1], [2, 5], 1_000), year: 2025 };
    expect(lowestRate({ ...RULES, seasons: [past] }, "2027-01-15")).toBe(7_000);
    expect(
      lowestRate({ ...RULES, defaultNightlyRateMinor: 0, seasons: [] }, "2027-01-15"),
    ).toBeNull();
  });
});

describe("a stored breakdown", () => {
  it("is read back, legacy or computed, and anything else is not", () => {
    const computed = priceStay(RULES, { checkIn: "2027-07-01", checkOut: "2027-07-02" });
    expect(parseBreakdown(JSON.parse(JSON.stringify(computed)))).toEqual(computed);
    const legacy = { version: 1, kind: "legacy", currency: "EUR", totalMinor: 123 };
    expect(parseBreakdown(legacy)).toEqual(legacy);
    expect(
      parseBreakdown({ version: 2, kind: "legacy", currency: "EUR", totalMinor: 1 }),
    ).toBeNull();
    expect(parseBreakdown(null)).toBeNull();
  });
});

describe("length-of-stay discounts", () => {
  const TIERED: PricingRules = {
    ...RULES,
    discounts: [
      { minNights: 7, percent: 10 },
      { minNights: 14, percent: 15 },
    ],
  };
  // September: no season, 70.00 a night, 50.00 cleaning.
  const stay = (nights: number) => ({
    checkIn: "2027-09-01",
    checkOut: `2027-09-${String(1 + nights).padStart(2, "0")}`,
  });

  it("gives none below the first tier", () => {
    const price = priceStay(TIERED, stay(6));
    expect(price.discount).toBeNull();
    expect(price.totalMinor).toBe(6 * 7_000 + 5_000);
  });

  it("starts exactly at a tier's night count, off the nights only", () => {
    const price = priceStay(TIERED, stay(7));
    expect(price.discount).toEqual({ minNights: 7, percent: 10, amountMinor: 4_900 });
    // 490.00 nights - 49.00 + 50.00 cleaning, which is not discounted.
    expect(price.totalMinor).toBe(49_000 - 4_900 + 5_000);
  });

  it("applies the highest tier the stay reaches, whatever the order", () => {
    const shuffled = { ...TIERED, discounts: [...TIERED.discounts].reverse() };
    expect(priceStay(shuffled, stay(14)).discount).toMatchObject({ minNights: 14, percent: 15 });
    expect(priceStay(shuffled, stay(13)).discount).toMatchObject({ minNights: 7 });
  });

  it("takes the whole stay's nights across a season boundary", () => {
    // 25-30 Jun at 70.00, 1-2 Jul at 95.00: 8 nights, 10% off.
    const price = priceStay(TIERED, { checkIn: "2027-06-25", checkOut: "2027-07-03" });
    expect(price.nightsMinor).toBe(6 * 7_000 + 2 * 9_500);
    expect(price.discount?.amountMinor).toBe(6_100);
    expect(price.totalMinor).toBe(61_000 - 6_100 + 5_000);
  });

  it("rounds to the nearest minor unit, also at a booking's own rate", () => {
    const price = priceStay(
      { ...RULES, discounts: [{ minNights: 2, percent: 15 }] },
      { checkIn: "2027-09-01", checkOut: "2027-09-04", nightlyRateMinor: 3_333 },
    );
    // 99.99 x 15% = 14.9985, rounded to 15.00.
    expect(price.discount?.amountMinor).toBe(1_500);
    expect(price.totalMinor).toBe(9_999 - 1_500 + 5_000);
  });

  it("is absent from breakdowns kept before discounts existed, and still reads", () => {
    const old = priceStay(RULES, stay(3));
    delete (old as { discount?: unknown }).discount;
    expect(parseBreakdown(JSON.parse(JSON.stringify(old)))).toEqual(old);
  });
});
