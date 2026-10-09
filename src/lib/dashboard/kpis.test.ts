import { describe, expect, it } from "vitest";

import { buildKpis, margin, pointsChange, relativeChange, type Report } from "./kpis";

const totals = (income: number, expenses: number, occupancy: number | null) => ({
  incomeMinor: income,
  expensesMinor: expenses,
  netMinor: income - expenses,
  occupancyRate: occupancy,
});

function report(now: Report["totals"], before: Report["totals"]): Report {
  return { currency: "EUR", totals: now, prior: { compare: "year", totals: before } };
}

const upcoming = { count: 3, days: 30 };
const byId = (kpis: ReturnType<typeof buildKpis>) => Object.fromEntries(kpis.map((k) => [k.id, k]));

describe("changes", () => {
  it("colours a change by whether up is good", () => {
    expect(relativeChange(120, 100, true, "year")).toMatchObject({
      text: "+20%",
      direction: "up",
      good: true,
      against: "vs the same dates last year",
    });
    expect(relativeChange(120, 100, false, "previous")).toMatchObject({
      direction: "up",
      good: false,
      against: "vs the previous period",
    });
    expect(relativeChange(100, 100, true, "year")).toMatchObject({ text: "0%", good: null });
  });

  it("never divides by a zero prior", () => {
    expect(relativeChange(500, 0, true, "year")).toBeNull();
    expect(relativeChange(0, 0, true, "year")).toBeNull();
  });

  it("measures rates in percentage points", () => {
    expect(pointsChange(0.74, 0.6, "year")).toMatchObject({ text: "+14 pts", good: true });
    expect(pointsChange(0.5, null, "year")).toBeNull();
  });

  it("has no margin without revenue", () => {
    expect(margin(totals(0, 500, null))).toBeNull();
    expect(margin(totals(1000, 250, null))).toBe(0.75);
  });
});

describe("buildKpis", () => {
  it("builds the six cards with their changes", () => {
    const kpis = byId(
      buildKpis(report(totals(120000, 30000, 0.74), totals(100000, 40000, 0.6)), upcoming),
    );
    expect(kpis.revenue).toMatchObject({ value: "€1,200.00", delta: { text: "+20%", good: true } });
    expect(kpis.expenses).toMatchObject({ value: "€300.00", delta: { text: "-25%", good: true } });
    expect(kpis.net).toMatchObject({ value: "€900.00", delta: { text: "+50%", good: true } });
    expect(kpis.margin).toMatchObject({ value: "75%", delta: { text: "+15 pts" } });
    expect(kpis.occupancy).toMatchObject({ value: "74%", delta: { text: "+14 pts" } });
    expect(kpis.upcoming).toMatchObject({
      value: "3",
      delta: null,
      note: "arriving in the next 30 days",
    });
  });

  it("shows an empty period neutrally, never NaN or -100%", () => {
    const kpis = buildKpis(report(totals(0, 0, null), totals(0, 0, null)), { count: 0, days: 30 });
    for (const kpi of kpis) {
      expect(kpi.value).not.toMatch(/NaN|Infinity/);
      expect(kpi.delta).toBeNull();
    }
    expect(byId(kpis).net!.value).toBe("–");
    expect(byId(kpis).margin!.value).toBe("–");
    expect(byId(kpis).occupancy!.value).toBe("–");
  });

  it("shows no change against a prior period that had nothing", () => {
    const kpis = byId(buildKpis(report(totals(50000, 0, 0.5), totals(0, 0, null)), upcoming));
    expect(kpis.revenue!.delta).toBeNull();
    expect(kpis.occupancy!.delta).toBeNull();
  });

  it("reports a real drop to zero as -100% only when there was something before", () => {
    const kpis = byId(buildKpis(report(totals(0, 1000, 0), totals(80000, 1000, 0.4)), upcoming));
    expect(kpis.revenue!.delta).toMatchObject({ text: "-100%", good: false });
  });
});
