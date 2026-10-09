import { describe, expect, it } from "vitest";

import { analyticsQuery, dashboardHref, dashboardState, presetRange, thisMonth } from "./params";

const TODAY = "2026-10-08";

describe("dashboard params", () => {
  it("defaults to the current month, compared with a year earlier", () => {
    expect(thisMonth(TODAY)).toEqual({ from: "2026-10-01", until: "2026-10-31" });
    expect(dashboardState({}, TODAY)).toEqual({
      preset: "this-month",
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
    ).toEqual({
      preset: "custom",
      from: "2026-01-01",
      until: "2026-03-31",
      propertyId: "p1",
      compare: "previous",
    });
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

describe("presets", () => {
  it("resolve against today", () => {
    expect(presetRange("this-month", TODAY)).toEqual({ from: "2026-10-01", until: "2026-10-31" });
    expect(presetRange("last-month", TODAY)).toEqual({ from: "2026-09-01", until: "2026-09-30" });
    expect(presetRange("last-month", "2026-01-15")).toEqual({
      from: "2025-12-01",
      until: "2025-12-31",
    });
    expect(presetRange("year-to-date", TODAY)).toEqual({ from: "2026-01-01", until: TODAY });
    expect(presetRange("last-12-months", TODAY)).toEqual({
      from: "2025-11-01",
      until: "2026-10-31",
    });
  });

  it("win over dates in the URL", () => {
    expect(
      dashboardState({ preset: "last-month", from: "2020-01-01", until: "2020-01-31" }, TODAY),
    ).toMatchObject({ preset: "last-month", from: "2026-09-01" });
  });

  it("make links that keep their meaning when shared", () => {
    const at = (params: Record<string, string>) => dashboardHref(dashboardState(params, TODAY));
    expect(at({})).toBe("/dashboard");
    expect(at({ preset: "year-to-date", propertyId: "p1" })).toBe(
      "/dashboard?preset=year-to-date&propertyId=p1",
    );
    expect(at({ from: "2026-02-01", until: "2026-02-28" })).toBe(
      "/dashboard?from=2026-02-01&until=2026-02-28",
    );
  });
});
