import { describe, expect, it } from "vitest";

import { analyticsQuery, dashboardState, thisMonth } from "./params";

const TODAY = "2026-10-08";

describe("dashboard params", () => {
  it("defaults to the current month, compared with a year earlier", () => {
    expect(thisMonth(TODAY)).toEqual({ from: "2026-10-01", until: "2026-10-31" });
    expect(dashboardState({}, TODAY)).toEqual({
      from: "2026-10-01",
      until: "2026-10-31",
      propertyId: undefined,
      compare: "year",
    });
  });

  it("reads a range, a property and the comparison", () => {
    expect(
      dashboardState(
        { from: "2026-01-01", until: "2026-03-31", propertyId: "p1", compare: "previous" },
        TODAY,
      ),
    ).toEqual({ from: "2026-01-01", until: "2026-03-31", propertyId: "p1", compare: "previous" });
  });

  it("falls back to the current month for a broken or backwards range", () => {
    expect(dashboardState({ from: "2026-13-01", until: "2026-03-31" }, TODAY).from).toBe(
      "2026-10-01",
    );
    expect(dashboardState({ from: "2026-05-01", until: "2026-03-31" }, TODAY).from).toBe(
      "2026-10-01",
    );
    expect(dashboardState({ from: "2026-05-01" }, TODAY).from).toBe("2026-10-01");
  });

  it("asks the API for [from, the day after until)", () => {
    expect(
      analyticsQuery(dashboardState({ from: "2026-02-01", until: "2026-02-28" }, TODAY)),
    ).toEqual({
      from: "2026-02-01",
      to: "2026-03-01",
      propertyId: undefined,
      compare: "year",
    });
  });
});
