import { describe, expect, it } from "vitest";

import { calculateTotalMinor, MAX_AMOUNT_MINOR, nights } from "@/lib/bookings/pricing";

describe("nights", () => {
  it("counts check-out as exclusive", () => {
    expect(nights("2026-07-14", "2026-07-18")).toBe(4);
    expect(nights("2026-07-14", "2026-07-15")).toBe(1);
  });

  it("refuses a stay that does not end after it starts", () => {
    expect(() => nights("2026-07-14", "2026-07-14")).toThrow(RangeError);
    expect(() => nights("2026-07-18", "2026-07-14")).toThrow(RangeError);
  });
});

describe("calculateTotalMinor", () => {
  it("is nights x rate + cleaning fee, exactly", () => {
    expect(
      calculateTotalMinor({
        checkIn: "2026-07-14",
        checkOut: "2026-07-18",
        nightlyRateMinor: 12_345,
        cleaningFeeMinor: 4_999,
      }),
    ).toBe(4 * 12_345 + 4_999);
  });

  it("stays exact where floating-point decimals would not", () => {
    // Three nights at 0.10 as floats is 0.30000000000000004, not 0.30.
    expect(3 * 0.1).not.toBe(0.3);
    expect(
      calculateTotalMinor({
        checkIn: "2026-01-01",
        checkOut: "2026-01-04",
        nightlyRateMinor: 10,
        cleaningFeeMinor: 0,
      }),
    ).toBe(30);
  });

  it("refuses fractional or negative amounts and totals that cannot be stored", () => {
    const stay = { checkIn: "2026-01-01", checkOut: "2026-01-02" };
    expect(() =>
      calculateTotalMinor({ ...stay, nightlyRateMinor: 10.5, cleaningFeeMinor: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      calculateTotalMinor({ ...stay, nightlyRateMinor: -1, cleaningFeeMinor: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      calculateTotalMinor({
        checkIn: "2026-01-01",
        checkOut: "2026-01-03",
        nightlyRateMinor: MAX_AMOUNT_MINOR,
        cleaningFeeMinor: 0,
      }),
    ).toThrow(/exceeds/);
  });
});
