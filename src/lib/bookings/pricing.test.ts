import { describe, expect, it } from "vitest";

import { nights } from "@/lib/bookings/pricing";

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
