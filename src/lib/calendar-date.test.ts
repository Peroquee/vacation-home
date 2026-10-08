import { describe, expect, it } from "vitest";

import { addDays, daysBetween, fromUtcDate, isCalendarDate, toUtcDate } from "@/lib/calendar-date";

describe("calendar dates", () => {
  it("round-trip through midnight UTC", () => {
    for (const date of ["2026-01-01", "2026-03-29", "2026-10-25", "2028-02-29", "2026-12-31"]) {
      expect(fromUtcDate(toUtcDate(date))).toBe(date);
    }
  });

  it("reject malformed and impossible dates", () => {
    for (const bad of ["2026-2-1", "2026-02-30", "2027-02-29", "26-01-01", "2026-01-01T00:00"]) {
      expect(isCalendarDate(bad)).toBe(false);
    }
    expect(() => fromUtcDate(new Date("2026-01-01T12:00:00Z"))).toThrow(RangeError);
  });

  it("count days across month, year and DST boundaries", () => {
    expect(daysBetween("2026-07-14", "2026-07-18")).toBe(4);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    // Europe and the US change clocks in these windows; days stay whole.
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2026-07-18", "2026-07-14")).toBe(-4);
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});
