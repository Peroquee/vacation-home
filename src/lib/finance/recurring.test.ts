import { describe, expect, it } from "vitest";

import { firstOccurrenceFrom, occurrenceDate, todayIn } from "./recurring";

describe("occurrenceDate", () => {
  it("steps by the interval, keeping the day of the month", () => {
    expect([0, 1, 2].map((n) => occurrenceDate("2026-01-15", "monthly", n))).toEqual([
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
    ]);
    expect([0, 1, 4].map((n) => occurrenceDate("2026-11-30", "quarterly", n))).toEqual([
      "2026-11-30",
      "2027-02-28",
      "2027-11-30",
    ]);
    expect(occurrenceDate("2026-06-01", "annual", 3)).toBe("2029-06-01");
  });

  it("uses the month's last day when it is shorter, without drifting", () => {
    expect([0, 1, 2, 3, 13].map((n) => occurrenceDate("2026-01-31", "monthly", n))).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2027-02-28",
    ]);
    expect(occurrenceDate("2027-01-31", "monthly", 13)).toBe("2028-02-29");
    expect(occurrenceDate("2028-02-29", "annual", 1)).toBe("2029-02-28");
    expect(occurrenceDate("2028-02-29", "annual", 4)).toBe("2032-02-29");
  });
});

describe("firstOccurrenceFrom", () => {
  it("finds the first occurrence on or after a date", () => {
    expect(firstOccurrenceFrom("2026-01-15", "monthly", "2026-01-01")).toBe(0);
    expect(firstOccurrenceFrom("2026-01-15", "monthly", "2026-01-15")).toBe(0);
    expect(firstOccurrenceFrom("2026-01-15", "monthly", "2026-01-16")).toBe(1);
    expect(firstOccurrenceFrom("2026-01-15", "monthly", "2026-06-15")).toBe(5);
    expect(firstOccurrenceFrom("2026-01-31", "monthly", "2026-03-01")).toBe(2);
    expect(firstOccurrenceFrom("2026-01-01", "quarterly", "2026-12-31")).toBe(4);
    expect(firstOccurrenceFrom("2020-03-10", "annual", "2026-03-11")).toBe(7);
  });
});

describe("todayIn", () => {
  it("is the property's local date", () => {
    const instant = new Date("2026-01-01T03:00:00Z");
    expect(todayIn("Europe/Lisbon", instant)).toBe("2026-01-01");
    expect(todayIn("America/Los_Angeles", instant)).toBe("2025-12-31");
  });
});
