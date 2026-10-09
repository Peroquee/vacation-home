import { describe, expect, it } from "vitest";

import { heatmap, heatmapWindow, heatStep, monthlyOccupancy, withPriorYear } from "./occupancy";

describe("monthlyOccupancy", () => {
  it("divides booked by available nights, and has no rate without available nights", () => {
    expect(
      monthlyOccupancy([
        { month: "2026-06", bookedNights: 15, availableNights: 30 },
        { month: "2026-07", bookedNights: 0, availableNights: 0 },
      ]),
    ).toEqual([
      { month: "2026-06", rate: 0.5, booked: 15, available: 30 },
      { month: "2026-07", rate: null, booked: 0, available: 0 },
    ]);
  });

  it("pairs each month with the same month a year earlier", () => {
    const now = monthlyOccupancy([{ month: "2026-06", bookedNights: 15, availableNights: 30 }]);
    const before = monthlyOccupancy([{ month: "2025-06", bookedNights: 6, availableNights: 30 }]);
    expect(withPriorYear(now, before)[0]).toMatchObject({ rate: 0.5, priorRate: 0.2 });
    expect(withPriorYear(now, null)[0]!.priorRate).toBeNull();
  });
});

describe("heatmap", () => {
  it("covers the twelve months ending with the range's last month", () => {
    expect(heatmapWindow("2026-10-08")).toEqual({ start: "2025-11-01", end: "2026-11-01" });
  });

  it("counts booked properties per night, month by month", () => {
    const months = heatmap({ start: "2026-01-30", end: "2026-02-02" }, [
      {
        days: [
          { date: "2026-01-30", status: "booked" },
          { date: "2026-01-31", status: "inquiry" },
          { date: "2026-02-01", status: "booked" },
        ],
      },
      { days: [{ date: "2026-02-01", status: "booked" }] },
    ]);
    expect(months).toEqual([
      {
        month: "2026-01",
        days: [
          { date: "2026-01-30", booked: 1 },
          { date: "2026-01-31", booked: 0 },
        ],
      },
      { month: "2026-02", days: [{ date: "2026-02-01", booked: 2 }] },
    ]);
  });

  it("steps the ramp by share of properties booked", () => {
    expect(heatStep(0, 3, 4)).toBe(0);
    expect(heatStep(1, 1, 4)).toBe(4);
    expect(heatStep(1, 3, 4)).toBe(1);
    expect(heatStep(3, 3, 4)).toBe(4);
  });
});
