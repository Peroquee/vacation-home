import { describe, expect, it } from "vitest";

import { priceStay, type PricingRules, repriceTouristTax } from "./engine";
import { allAdults, type TouristTaxRules, touristTaxFor } from "./tourist-tax";

const RULES: TouristTaxRules = {
  adultRateMinor: 300,
  childGroups: [
    { fromAge: 0, toAge: 5, rateMinor: 0 },
    { fromAge: 6, toAge: 15, rateMinor: 150 },
  ],
  periods: [],
  maxNights: null,
  included: false,
};
const family = {
  adults: 2,
  children: [
    { fromAge: 0, toAge: 5, count: 1 },
    { fromAge: 6, toAge: 15, count: 1 },
  ],
};

describe("the Kurtaxe", () => {
  it("charges adults and each child group by its rate; free groups add no line", () => {
    expect(touristTaxFor(RULES, "2027-09-01", 5, family)).toEqual({
      included: false,
      amountMinor: 2 * 5 * 300 + 5 * 150,
      lines: [
        { group: null, period: null, persons: 2, nights: 5, rateMinor: 300, amountMinor: 3_000 },
        {
          group: { fromAge: 6, toAge: 15 },
          period: null,
          persons: 1,
          nights: 5,
          rateMinor: 150,
          amountMinor: 750,
        },
      ],
    });
  });

  it("charges only the first nights when the rules cap them", () => {
    const tax = touristTaxFor({ ...RULES, maxNights: 3 }, "2027-09-01", 10, allAdults(2));
    expect(tax?.amountMinor).toBe(2 * 3 * 300);
    expect(tax?.lines[0]?.nights).toBe(3);
  });

  it("uses a period's own rates on its nights, also for the children", () => {
    const rules: TouristTaxRules = {
      ...RULES,
      periods: [
        {
          name: "Hochsaison",
          startMonth: 7,
          startDay: 1,
          endMonth: 8,
          endDay: 31,
          adultRateMinor: 400,
          childRatesMinor: { "6-15": 200 },
        },
      ],
    };
    // 29, 30 Jun outside; 1, 2 Jul inside.
    const tax = touristTaxFor(rules, "2027-06-29", 4, {
      adults: 1,
      children: [{ fromAge: 6, toAge: 15, count: 1 }],
    });
    expect(
      tax?.lines.map((l) => [l.group?.fromAge ?? "adult", l.period, l.nights, l.rateMinor]),
    ).toEqual([
      ["adult", null, 2, 300],
      [6, null, 2, 150],
      ["adult", "Hochsaison", 2, 400],
      [6, "Hochsaison", 2, 200],
    ]);
    expect(tax?.amountMinor).toBe(2 * 300 + 2 * 150 + 2 * 400 + 2 * 200);
  });

  it("charges a child of a group the rules no longer have as an adult", () => {
    const tax = touristTaxFor(RULES, "2027-09-01", 2, {
      adults: 1,
      children: [{ fromAge: 16, toAge: 17, count: 1 }],
    });
    expect(tax?.lines).toEqual([
      { group: null, period: null, persons: 2, nights: 2, rateMinor: 300, amountMinor: 1_200 },
    ]);
  });

  it("is nothing when nobody pays", () => {
    expect(
      touristTaxFor(RULES, "2027-09-01", 3, {
        adults: 0,
        children: [{ fromAge: 0, toAge: 5, count: 2 }],
      }),
    ).toBeNull();
  });
});

describe("the Kurtaxe in a price", () => {
  const PRICING: PricingRules = {
    currency: "EUR",
    defaultNightlyRateMinor: 10_000,
    defaultCleaningFeeMinor: 5_000,
    seasons: [],
    discounts: [{ minNights: 5, percent: 10 }],
    touristTax: RULES,
  };
  const stay = { checkIn: "2027-09-01", checkOut: "2027-09-06", guests: family };

  it("is added to the total, after the discount on the nights only", () => {
    const price = priceStay(PRICING, stay);
    expect(price.discount?.amountMinor).toBe(5_000);
    expect(price.touristTax?.amountMinor).toBe(3_750);
    expect(price.totalMinor).toBe(50_000 - 5_000 + 5_000 + 3_750);
    expect(price.touristTaxRules).toEqual(RULES);
  });

  it("included in the rates, is shown but leaves the total alone", () => {
    const price = priceStay({ ...PRICING, touristTax: { ...RULES, included: true } }, stay);
    expect(price.touristTax).toMatchObject({ included: true, amountMinor: 3_750 });
    expect(price.totalMinor).toBe(50_000 - 5_000 + 5_000);
  });

  it("is left out while the guests are not known", () => {
    const price = priceStay(PRICING, { checkIn: stay.checkIn, checkOut: stay.checkOut });
    expect(price.touristTax).toBeNull();
    expect(price.totalMinor).toBe(50_000);
  });

  it("re-priced for other guests by the rules it was made under, nothing else moving", () => {
    const price = priceStay(PRICING, stay);
    const later = repriceTouristTax(price, { ...stay, guests: allAdults(3) });
    expect(later.touristTax?.amountMinor).toBe(3 * 5 * 300);
    expect({ ...later, touristTax: null }).toEqual({
      ...price,
      touristTax: null,
      totalMinor: later.totalMinor,
    });
    expect(later.totalMinor).toBe(price.totalMinor - 3_750 + 4_500);
  });

  it("set by hand for the booking (an exemption), with its note", () => {
    const price = priceStay(PRICING, stay);
    const exempt = repriceTouristTax(price, stay, { amountMinor: 0, note: "Dienstreise" });
    expect(exempt.touristTax).toEqual({
      included: false,
      lines: [],
      amountMinor: 0,
      manual: { note: "Dienstreise" },
    });
    expect(exempt.totalMinor).toBe(price.totalMinor - 3_750);
  });
});
