// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { RevenueExpensesChart } from "./revenue-expenses-chart";

beforeAll(() => {
  // jsdom has no layout, and the chart's container watches its size.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const months = [
  { month: "2026-05", incomeMinor: 120000, expensesMinor: 30000, netMinor: 90000 },
  // No figures at all: an explicit zero, not a gap.
  { month: "2026-06", incomeMinor: 0, expensesMinor: 0, netMinor: 0 },
  { month: "2026-07", incomeMinor: 50000, expensesMinor: 80000, netMinor: -30000 },
];

describe("RevenueExpensesChart", () => {
  it("names every series in a legend, so identity never rests on colour", () => {
    render(<RevenueExpensesChart months={months} currency="EUR" />);
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Income", "Expenses", "Net profit"]);
  });

  it("offers every figure as a table, with empty months as explicit zeros", async () => {
    render(<RevenueExpensesChart months={months} currency="EUR" />);
    await userEvent.setup().click(screen.getByText("Show the figures as a table"));

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      "May 2026€1,200.00€300.00€900.00",
      "June 2026€0.00€0.00€0.00",
      "July 2026€500.00€800.00-€300.00",
    ]);
  });
});
