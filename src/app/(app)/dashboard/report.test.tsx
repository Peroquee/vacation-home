import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { renderFinancialReport } from "@/lib/reports/financial-pdf";

import { Kpis } from "./kpis";
import { buildReportContent } from "./report";

const totals = (income: number, expenses: number, occupancy: number) => ({
  incomeMinor: income,
  expensesMinor: expenses,
  netMinor: income - expenses,
  occupancyRate: occupancy,
});
const month = (m: string, income: number, expenses: number, booked: number, available: number) => ({
  month: m,
  incomeMinor: income,
  expensesMinor: expenses,
  netMinor: income - expenses,
  bookedNights: booked,
  availableNights: available,
});

const report = {
  currency: "EUR",
  months: [month("2026-06", 412345, 90011, 20, 30), month("2026-07", 523456, 101234, 28, 31)],
  totals: totals(935801, 191245, 48 / 61),
  prior: { compare: "year", totals: totals(800000, 200000, 0.6) },
  expensesByCategory: [
    { categoryId: "c1", name: "Cleaning", color: "#2a78d6", amountMinor: 150000, share: 0.7843 },
    { categoryId: "c2", name: "Utilities", color: "#eb6834", amountMinor: 41245, share: 0.2157 },
  ],
};
vi.mock("./data", () => ({ loadReport: async () => ({ ok: true, result: { report } }) }));
vi.mock("@/lib/dashboard/upcoming", () => ({ countUpcoming: async () => 3 }));

const state = {
  preset: "custom" as const,
  from: "2026-06-01",
  until: "2026-07-31",
  compare: "year" as const,
};

describe("the financial report", () => {
  it("shows exactly the dashboard's figures for the same filters", async () => {
    const screen = renderToStaticMarkup((await Kpis({ state, today: "2026-10-09" }))!);
    const outcome = await buildReportContent(state, "2026-10-09", null);
    if (outcome.kind !== "ok") throw new Error(outcome.kind);
    const { kpis } = outcome.content;

    expect(kpis.map((k) => k.label)).toEqual([
      "Revenue",
      "Expenses",
      "Net profit",
      "Profit margin",
      "Occupancy rate",
      "Upcoming bookings",
    ]);
    for (const kpi of kpis) {
      // React escapes text; the figures themselves contain nothing to escape.
      expect(screen).toContain(kpi.value);
      if (kpi.change) expect(screen).toContain(kpi.change.split(" ")[0]);
    }
    expect(kpis[0]!.value).toBe("€9,358.01");
    expect(kpis[4]!.value).toBe("78.7%");
  });

  it("lists months, categories and occupancy in the request's language", async () => {
    const outcome = await buildReportContent(state, "2026-10-09", "Lake House");
    if (outcome.kind !== "ok") throw new Error(outcome.kind);
    const { content } = outcome;
    expect(content.subtitle).toMatch(/Lake House$/);
    expect(content.months.rows).toEqual([
      { month: "June 2026", income: "€4,123.45", expenses: "€900.11", net: "€3,223.34" },
      { month: "July 2026", income: "€5,234.56", expenses: "€1,012.34", net: "€4,222.22" },
    ]);
    expect(content.categories.rows.map((r) => [r.name, r.amount, r.share])).toEqual([
      ["Cleaning", "€1,500.00", "78.4%"],
      ["Utilities", "€412.45", "21.6%"],
    ]);
    expect(content.occupancy.rows[1]).toMatchObject({ nights: "28 of 31", rate: "90%" });
  });

  it("renders a PDF", async () => {
    const outcome = await buildReportContent(state, "2026-10-09", null);
    if (outcome.kind !== "ok") throw new Error(outcome.kind);
    const pdf = await renderFinancialReport(outcome.content);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
  });
});
