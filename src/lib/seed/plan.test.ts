import { describe, expect, it } from "vitest";

import { findConflicts } from "@/lib/availability/rules";
import { daysBetween } from "@/lib/calendar-date";
import { buildSeedPlan, WINDOW } from "@/lib/seed/plan";

const plan = buildSeedPlan();

describe("the seed plan", () => {
  it("is identical on every run", () => {
    expect(buildSeedPlan()).toEqual(plan);
    expect(buildSeedPlan(1)).not.toEqual(plan);
  });

  it("has the shape the issue asks for", () => {
    expect(plan.properties).toHaveLength(2);
    expect(plan.guests).toHaveLength(20);
    expect(plan.bookings.length).toBeGreaterThanOrEqual(50);
    expect(plan.bookings.length).toBeLessThanOrEqual(75);
    expect(plan.blocks.length).toBeGreaterThanOrEqual(2);
    expect(daysBetween(WINDOW.start, WINDOW.end)).toBe(547); // 18 months
  });

  it("varies statuses, sources and blocks enough to exercise every view", () => {
    const count = <T>(values: T[]) =>
      values.reduce((map, v) => map.set(v, (map.get(v) ?? 0) + 1), new Map<T, number>());
    const statuses = count(plan.bookings.map((b) => b.status));
    const sources = count(plan.bookings.map((b) => b.source));

    expect([...statuses.keys()].sort()).toEqual(["cancelled", "confirmed", "inquiry"]);
    expect(statuses.get("confirmed")!).toBeGreaterThan(plan.bookings.length / 2);
    expect([...sources.keys()].sort()).toEqual(["airbnb", "booking.com", "direct", "other"]);
    expect(new Set(plan.blocks.map((b) => b.origin))).toEqual(new Set(["manual", "google"]));
    expect(new Set(plan.bookings.map((b) => b.property))).toEqual(new Set(["lake", "cabin"]));

    // At least one same-day turnover, which the calendar must draw.
    const confirmed = plan.bookings.filter((b) => b.status === "confirmed");
    expect(
      confirmed.some((a) =>
        confirmed.some((b) => a.property === b.property && a.checkOut === b.checkIn),
      ),
    ).toBe(true);
  });

  it("only plans what the database accepts: no confirmed overlaps, in range, totals right", () => {
    for (const property of plan.properties) {
      const bookings = plan.bookings
        .filter((b) => b.property === property.key)
        .map((b, i) => ({ id: String(i), status: b.status, start: b.checkIn, end: b.checkOut }));
      const blocks = plan.blocks
        .filter((b) => b.property === property.key)
        .map((b, i) => ({
          id: `k${i}`,
          reason: b.reason,
          origin: b.origin,
          start: b.startDate,
          end: b.endDate,
        }));

      for (const booking of bookings.filter((b) => b.status === "confirmed")) {
        const others = bookings.filter((b) => b.id !== booking.id);
        expect(findConflicts(booking, others, blocks)).toEqual([]);
      }
    }

    for (const k of plan.blocks) {
      expect(k.startDate >= WINDOW.start && k.endDate <= WINDOW.end).toBe(true);
      expect(k.endDate > k.startDate).toBe(true);
    }
    for (const b of plan.bookings) {
      expect(b.checkIn >= WINDOW.start && b.checkOut <= WINDOW.end).toBe(true);
      const calculated = b.priceBreakdown.totalMinor;
      expect(calculated).toBe(b.priceBreakdown.nightsMinor + b.priceBreakdown.cleaningFeeMinor);
      expect(
        b.totalIsManual ? b.totalAmountMinor <= calculated : b.totalAmountMinor === calculated,
      ).toBe(true);
    }
  });
});
