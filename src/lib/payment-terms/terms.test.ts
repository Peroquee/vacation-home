import { describe, expect, it } from "vitest";

import { DEFAULT_TERMS, depositFor, holdFor } from "./terms";

const TODAY = "2026-07-01";
const hold = (checkIn: string, totalMinor = 100_000, terms = DEFAULT_TERMS) =>
  holdFor({ totalMinor, checkIn, today: TODAY }, terms);

describe("the hold on a reserved booking", () => {
  it("asks for a 20% deposit within 7 days and the balance 30 days before arrival", () => {
    expect(hold("2026-09-01")).toEqual({
      depositAmountMinor: 20_000,
      depositDueOn: "2026-07-08",
      balanceDueOn: "2026-08-02",
    });
  });

  it("asks for the full amount within 3 days when arrival is 30 days off or closer", () => {
    // 30 days: the balance would be due today.
    expect(hold("2026-07-31")).toEqual({
      depositAmountMinor: 100_000,
      depositDueOn: "2026-07-04",
      balanceDueOn: null,
    });
    // 31 days: a deposit still, the balance no earlier than the deposit.
    expect(hold("2026-08-01")).toEqual({
      depositAmountMinor: 20_000,
      depositDueOn: "2026-07-08",
      balanceDueOn: "2026-07-08",
    });
  });

  it("never sets a deadline after the day before arrival, nor before today", () => {
    expect(hold("2026-07-03").depositDueOn).toBe("2026-07-02");
    expect(hold("2026-07-02").depositDueOn).toBe(TODAY);
    expect(hold(TODAY).depositDueOn).toBe(TODAY);
    // With no balance lead at all, the deposit is still due before arrival.
    expect(hold("2026-07-05", 100_000, { ...DEFAULT_TERMS, balanceDueDaysBefore: 0 })).toEqual({
      depositAmountMinor: 20_000,
      depositDueOn: "2026-07-04",
      balanceDueOn: "2026-07-05",
    });
  });

  it("takes a fixed deposit, and the full amount when the deposit would be all of it", () => {
    const fixed = { ...DEFAULT_TERMS, depositPercent: null, depositFixedMinor: 30_000 };
    expect(hold("2026-09-01", 100_000, fixed).depositAmountMinor).toBe(30_000);
    expect(hold("2026-09-01", 25_000, fixed)).toEqual({
      depositAmountMinor: 25_000,
      depositDueOn: "2026-07-08",
      balanceDueOn: null,
    });
  });
});

describe("the deposit", () => {
  it("is rounded to the minor unit", () => {
    expect(depositFor(33_333, DEFAULT_TERMS)).toBe(6_667);
    expect(depositFor(12_345, { ...DEFAULT_TERMS, depositPercent: 30 })).toBe(3_704);
    expect(depositFor(0, DEFAULT_TERMS)).toBe(0);
  });
});
