import { describe, expect, it } from "vitest";

import { isActive } from "@/lib/navigation";

describe("isActive", () => {
  it("matches the route itself and anything nested under it", () => {
    expect(isActive("/bookings", "/bookings")).toBe(true);
    expect(isActive("/bookings/42", "/bookings")).toBe(true);
  });

  it("does not match a route that merely shares a prefix", () => {
    expect(isActive("/bookings-archive", "/bookings")).toBe(false);
    expect(isActive("/", "/bookings")).toBe(false);
  });
});
