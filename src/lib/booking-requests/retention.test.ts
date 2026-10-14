import { describe, expect, it } from "vitest";

import { monthsBefore } from "./retention";

const before = (iso: string, months: number) => monthsBefore(new Date(iso), months).toISOString();

describe("months before a date", () => {
  it("keeps the day and time of day", () => {
    expect(before("2027-01-01T12:00:00.000Z", 6)).toBe("2026-07-01T12:00:00.000Z");
    expect(before("2027-01-15T08:30:00.000Z", 18)).toBe("2025-07-15T08:30:00.000Z");
  });

  it("takes the last day of a shorter month, never rolling into the next", () => {
    expect(before("2026-12-31T12:00:00.000Z", 6)).toBe("2026-06-30T12:00:00.000Z");
    expect(before("2027-03-31T00:00:00.000Z", 1)).toBe("2027-02-28T00:00:00.000Z");
    expect(before("2028-03-31T00:00:00.000Z", 1)).toBe("2028-02-29T00:00:00.000Z");
    expect(before("2027-05-31T23:59:59.999Z", 3)).toBe("2027-02-28T23:59:59.999Z");
  });
});
