import { describe, expect, it } from "vitest";

import {
  compare,
  ledgerByMonth,
  monthlySeries,
  monthsIn,
  nightStats,
  priorRange,
  summarise,
} from "./rules";

const lake = { id: "lake", archivedOn: null };
const sea = { id: "sea", archivedOn: null };

describe("monthsIn", () => {
  it("clips the months at both ends of the range", () => {
    expect(monthsIn({ start: "2026-01-15", end: "2026-03-10" })).toEqual([
      { month: "2026-01", start: "2026-01-15", end: "2026-02-01" },
      { month: "2026-02", start: "2026-02-01", end: "2026-03-01" },
      { month: "2026-03", start: "2026-03-01", end: "2026-03-10" },
    ]);
  });

  it("handles whole months, a year boundary, and a single day", () => {
    expect(monthsIn({ start: "2025-12-01", end: "2026-02-01" }).map((m) => m.month)).toEqual([
      "2025-12",
      "2026-01",
    ]);
    expect(monthsIn({ start: "2026-05-31", end: "2026-06-01" })).toEqual([
      { month: "2026-05", start: "2026-05-31", end: "2026-06-01" },
    ]);
  });
});

describe("nightStats", () => {
  const range = { start: "2026-01-15", end: "2026-03-01" };

  it("counts a booking across a month boundary in each month, with its revenue", () => {
    // Jan 30 - Feb 3: 4 nights (Jan 30, Jan 31, Feb 1, Feb 2). Accommodation
    // 400_03 - 50_00 = 350_03 over 4 nights: 87_51 x 3 + 87_50, the extra
    // cents on the first nights.
    const stats = nightStats(
      range,
      [lake],
      [
        {
          propertyId: "lake",
          checkIn: "2026-01-30",
          checkOut: "2026-02-03",
          totalAmountMinor: 400_03,
          cleaningFeeMinor: 50_00,
        },
      ],
      [],
    );
    // January in range: the 15th to the 31st, 17 nights.
    expect(stats.get("2026-01")).toEqual({
      bookedNights: 2,
      blockedNights: 0,
      availableNights: 17,
      accommodationRevenueMinor: 87_51 * 2,
    });
    expect(stats.get("2026-02")).toEqual({
      bookedNights: 2,
      blockedNights: 0,
      availableNights: 28,
      accommodationRevenueMinor: 87_51 + 87_50,
    });
  });

  it("clips a booking that starts before the range or ends after it", () => {
    const stats = nightStats(
      { start: "2026-02-01", end: "2026-02-10" },
      [lake],
      [
        // Jan 28 - Feb 3: 6 nights at 100 each; Feb 1 and 2 are in range.
        {
          propertyId: "lake",
          checkIn: "2026-01-28",
          checkOut: "2026-02-03",
          totalAmountMinor: 600_00,
          cleaningFeeMinor: 0,
        },
        // Feb 8 - Feb 12: 4 nights at 50; Feb 8 and 9 are in range.
        {
          propertyId: "lake",
          checkIn: "2026-02-08",
          checkOut: "2026-02-12",
          totalAmountMinor: 200_00,
          cleaningFeeMinor: 0,
        },
      ],
      [],
    );
    expect(stats.get("2026-02")).toMatchObject({
      bookedNights: 4,
      availableNights: 9,
      accommodationRevenueMinor: 2 * 100_00 + 2 * 50_00,
    });
  });

  it("takes blocked nights out of the denominator, unless told not to", () => {
    const blocks = [
      // Feb 10-15 and an overlapping Feb 13-17: Feb 10-16, 7 nights.
      { propertyId: "lake", startDate: "2026-02-10", endDate: "2026-02-15" },
      { propertyId: "lake", startDate: "2026-02-13", endDate: "2026-02-17" },
    ];
    // A booking on Feb 16 too: booked, not blocked.
    const bookings = [
      {
        propertyId: "lake",
        checkIn: "2026-02-16",
        checkOut: "2026-02-17",
        totalAmountMinor: 100_00,
        cleaningFeeMinor: 0,
      },
    ];
    const feb = { start: "2026-02-01", end: "2026-03-01" };
    expect(nightStats(feb, [lake], bookings, blocks).get("2026-02")).toEqual({
      bookedNights: 1,
      blockedNights: 6,
      availableNights: 28 - 6,
      accommodationRevenueMinor: 100_00,
    });
    expect(
      nightStats(feb, [lake], bookings, blocks, { excludeBlocks: false }).get("2026-02"),
    ).toMatchObject({ blockedNights: 6, availableNights: 28 });
  });

  it("adds up properties, and stops counting a property once archived", () => {
    const stats = nightStats(
      { start: "2026-02-01", end: "2026-03-01" },
      [lake, { ...sea, archivedOn: "2026-02-11" }],
      [],
      [],
    );
    // Lake 28 nights, Sea the 1st to the 10th.
    expect(stats.get("2026-02")?.availableNights).toBe(28 + 10);
  });
});

describe("series, summary and comparison", () => {
  const range = { start: "2026-01-01", end: "2026-03-01" };
  const nights = nightStats(
    range,
    [lake],
    [
      // 10 nights in January at 120, 5 in February at 80 (no cleaning fee).
      {
        propertyId: "lake",
        checkIn: "2026-01-05",
        checkOut: "2026-01-15",
        totalAmountMinor: 1200_00,
        cleaningFeeMinor: 0,
      },
      {
        propertyId: "lake",
        checkIn: "2026-02-10",
        checkOut: "2026-02-15",
        totalAmountMinor: 450_00,
        cleaningFeeMinor: 50_00,
      },
    ],
    [{ propertyId: "lake", startDate: "2026-02-20", endDate: "2026-02-24" }],
  );
  const ledger = ledgerByMonth(range, [
    { date: "2026-01-05", type: "income", amountMinor: 1200_00 },
    { date: "2026-01-31", type: "expense", amountMinor: 300_00 },
    { date: "2026-02-01", type: "expense", amountMinor: 80_00 },
    { date: "2026-02-10", type: "income", amountMinor: 450_00 },
    // Outside the range: ignored.
    { date: "2026-03-01", type: "income", amountMinor: 999_00 },
  ]);
  const series = monthlySeries(range, nights, ledger);

  it("gives each month its income, expenses and net", () => {
    expect(
      series.map(({ month, incomeMinor, expensesMinor, netMinor }) => ({
        month,
        incomeMinor,
        expensesMinor,
        netMinor,
      })),
    ).toEqual([
      { month: "2026-01", incomeMinor: 1200_00, expensesMinor: 300_00, netMinor: 900_00 },
      { month: "2026-02", incomeMinor: 450_00, expensesMinor: 80_00, netMinor: 370_00 },
    ]);
  });

  it("summarises occupancy, ADR and RevPAN over the range", () => {
    // Nights: 31 + 28 = 59, 4 blocked, so 55 available; 15 booked.
    // Accommodation revenue: 1200 + (450 - 50) = 1600.
    expect(summarise(series)).toEqual({
      bookedNights: 15,
      blockedNights: 4,
      availableNights: 55,
      accommodationRevenueMinor: 1600_00,
      incomeMinor: 1650_00,
      expensesMinor: 380_00,
      netMinor: 1270_00,
      occupancyRate: 0.2727, // 15 / 55
      averageNightlyRateMinor: 106_67, // 1600 / 15 = 106.666...
      revenuePerAvailableNightMinor: 29_09, // 1600 / 55 = 29.0909...
    });
  });

  it("returns null rates rather than dividing by zero", () => {
    const empty = summarise(
      monthlySeries(range, nightStats(range, [], [], []), ledgerByMonth(range, [])),
    );
    expect(empty).toMatchObject({
      occupancyRate: null,
      averageNightlyRateMinor: null,
      revenuePerAvailableNightMinor: null,
    });
  });

  it("finds the equivalent prior period", () => {
    expect(priorRange({ start: "2026-01-15", end: "2026-03-10" }, "year")).toEqual({
      start: "2025-01-15",
      end: "2025-03-10",
    });
    expect(priorRange({ start: "2028-02-29", end: "2028-03-01" }, "year")).toEqual({
      start: "2027-02-28",
      end: "2027-03-01",
    });
    // 54 days right before.
    expect(priorRange({ start: "2026-01-15", end: "2026-03-10" }, "previous")).toEqual({
      start: "2025-11-22",
      end: "2026-01-15",
    });
  });

  it("compares against the prior period", () => {
    const current = summarise(series);
    const prior = {
      ...current,
      incomeMinor: 1100_00,
      occupancyRate: 0.25,
      averageNightlyRateMinor: null,
    };
    const change = compare(current, prior);
    expect(change.incomeMinor).toEqual({ delta: 550_00, percent: 50 });
    // (0.2727 - 0.25) / 0.25 = 9.08%.
    expect(change.occupancyRate).toEqual({ delta: 0.0227, percent: 9.1 });
    expect(change.averageNightlyRateMinor).toBeNull();
    expect(compare(current, { ...current, expensesMinor: 0 }).expensesMinor).toEqual({
      delta: 380_00,
      percent: null,
    });
  });
});
