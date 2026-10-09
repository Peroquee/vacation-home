// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StatTile } from "@/components/stat-tile";

import { Kpis } from "./kpis";

const analytics = vi.hoisted(() => ({ result: null as unknown }));
vi.mock("@/lib/analytics/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/service")>()),
  getAnalytics: async () => analytics.result,
}));
vi.mock("@/lib/dashboard/upcoming", () => ({ countUpcoming: async () => 2 }));

const totals = (income: number, expenses: number, occupancy: number | null) => ({
  incomeMinor: income,
  expensesMinor: expenses,
  netMinor: income - expenses,
  occupancyRate: occupancy,
});
const state = {
  preset: "custom" as const,
  from: "2026-07-01",
  until: "2026-07-31",
  compare: "year" as const,
};

async function renderKpis() {
  render(await Kpis({ state, today: "2026-07-10" }));
}

describe("StatTile", () => {
  it("says the direction in words as well as colour", () => {
    render(
      <StatTile
        label="Expenses"
        value="€300.00"
        delta={{ text: "+25%", direction: "up", good: false, against: "vs the previous period" }}
      />,
    );
    const change = screen.getByText("+25%").parentElement!;
    expect(change).toHaveTextContent("Up +25% vs the previous period");
    expect(change).toHaveClass("text-destructive");
  });

  it("falls back to its note, or says there is nothing to compare", () => {
    render(<StatTile label="Revenue" value="€0.00" />);
    expect(screen.getByText("No earlier figures to compare")).toBeInTheDocument();
  });
});

describe("dashboard KPI row", () => {
  it("shows the six figures with their changes", async () => {
    analytics.result = {
      report: {
        currency: "EUR",
        totals: totals(120000, 30000, 0.74),
        prior: { compare: "year", totals: totals(100000, 40000, 0.6) },
      },
    };
    await renderKpis();
    const row = screen.getByRole("region", { name: "Key figures" });
    for (const label of [
      "Revenue",
      "Expenses",
      "Net profit",
      "Profit margin",
      "Occupancy rate",
      "Upcoming bookings",
    ]) {
      expect(within(row).getByText(label)).toBeInTheDocument();
    }
    expect(within(row).getByText("€1,200.00")).toBeInTheDocument();
    expect(within(row).getByText("arriving in the next 30 days")).toBeInTheDocument();
  });

  it("keeps an empty period neutral: no NaN, no -100%", async () => {
    analytics.result = {
      report: {
        currency: "EUR",
        totals: totals(0, 0, null),
        prior: { compare: "year", totals: totals(0, 0, null) },
      },
    };
    await renderKpis();
    const row = screen.getByRole("region", { name: "Key figures" });
    expect(row).not.toHaveTextContent(/NaN|Infinity|-100%/);
    expect(within(row).getAllByText("No earlier figures to compare").length).toBeGreaterThan(0);
  });

  it("asks for one property when the currencies are mixed", async () => {
    analytics.result = { error: "mixed_currencies", currencies: ["CHF", "EUR"] };
    await renderKpis();
    expect(screen.getByText("Choose a property")).toBeInTheDocument();
    expect(screen.getByText(/different currencies \(CHF, EUR\)/)).toBeInTheDocument();
  });
});
