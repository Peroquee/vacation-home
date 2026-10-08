import { describe, expect, it } from "vitest";

import { type DateRange, rangesOverlap } from "@/lib/date-range";

const stay: DateRange = { start: "2026-07-14", end: "2026-07-18" };
const both = (a: DateRange, b: DateRange) => [rangesOverlap(a, b), rangesOverlap(b, a)];

describe("rangesOverlap", () => {
  it("detects the same range, partial overlap at either end, and containment", () => {
    expect(both(stay, stay)).toEqual([true, true]);
    expect(both(stay, { start: "2026-07-12", end: "2026-07-15" })).toEqual([true, true]);
    expect(both(stay, { start: "2026-07-17", end: "2026-07-20" })).toEqual([true, true]);
    expect(both(stay, { start: "2026-07-15", end: "2026-07-16" })).toEqual([true, true]);
    expect(both(stay, { start: "2026-07-01", end: "2026-07-31" })).toEqual([true, true]);
  });

  it("allows a same-day turnover and adjacent ranges", () => {
    // Departure on the 18th, arrival on the 18th.
    expect(both(stay, { start: "2026-07-18", end: "2026-07-20" })).toEqual([false, false]);
    expect(both(stay, { start: "2026-07-10", end: "2026-07-14" })).toEqual([false, false]);
  });

  it("finds no overlap between ranges that are apart", () => {
    expect(both(stay, { start: "2026-08-01", end: "2026-08-05" })).toEqual([false, false]);
  });

  it("refuses malformed dates rather than comparing them as text", () => {
    expect(() => rangesOverlap({ start: "2026-7-9", end: "2026-07-12" }, stay)).toThrow(RangeError);
  });

  it("compares across months and years", () => {
    expect(
      rangesOverlap(
        { start: "2026-12-30", end: "2027-01-02" },
        { start: "2027-01-01", end: "2027-01-03" },
      ),
    ).toBe(true);
  });
});
