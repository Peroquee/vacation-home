import { describe, expect, it } from "vitest";

import { parseSchedule, refundScheduleSchema } from "./schema";

const VALID = { freeMonthsBefore: 6, rampMonths: 5, startPercent: 20, endPercent: 100 };

describe("a refund schedule's rules (GitLab #123)", () => {
  it("takes a free window with a ramp inside it, or each part alone", () => {
    expect(refundScheduleSchema.parse(VALID)).toEqual(VALID);
    expect(refundScheduleSchema.parse({ ...VALID, rampMonths: 0 }).rampMonths).toBe(0);
    expect(
      refundScheduleSchema.parse({ freeMonthsBefore: null, startPercent: 50, endPercent: 50 }),
    ).toEqual({ freeMonthsBefore: null, rampMonths: 0, startPercent: 50, endPercent: 50 });
  });

  it("refuses shares out of order or range, too many months, and a ramp past the free window", () => {
    for (const bad of [
      { ...VALID, startPercent: 60, endPercent: 50 },
      { ...VALID, endPercent: 101 },
      { ...VALID, freeMonthsBefore: 25 },
      { ...VALID, rampMonths: 7 },
      { ...VALID, freeMonthsBefore: null },
    ]) {
      expect(refundScheduleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("reads back a stored schedule, or nothing from a bad one", () => {
    expect(parseSchedule(VALID)).toEqual(VALID);
    expect(parseSchedule(null)).toBeNull();
    expect(parseSchedule({ freeMonthsBefore: "soon" })).toBeNull();
  });
});
