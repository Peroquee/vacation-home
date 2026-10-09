// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { breakdownRows } from "@/lib/dashboard/breakdown";

import { ExpenseBreakdown } from "./expense-breakdown";

const total = 100_000;
const category = (name: string, amountMinor: number, color: string) => ({
  categoryId: name.toLowerCase(),
  name,
  color,
  amountMinor,
  share: amountMinor / total,
});

const rows = breakdownRows([
  category("Cleaning", 60_000, "#7c3aed"),
  category("Utilities", 36_000, "#ea580c"),
  category("Supplies", 2_500, "#65a30d"),
  category("Taxes", 1_500, "#4f46e5"),
]);

describe("ExpenseBreakdown", () => {
  it("writes each category's amount and share beside its bar", () => {
    render(<ExpenseBreakdown rows={rows} currency="EUR" />);
    const list = screen.getByRole("list", { name: "Expenses by category" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Cleaning€600.00 60%", "Utilities€360.00 36%", "Other (2 categories)€40.00 4%"]);
  });

  it("leads each category to the ledger, but not the combined Other row", () => {
    render(
      <ExpenseBreakdown
        rows={rows}
        currency="EUR"
        categoryHref={(id) => `/finance?categoryId=${id}`}
      />,
    );
    expect(
      screen.getByRole("link", { name: /^Cleaning: €600.00, 60% of expenses/ }),
    ).toHaveAttribute("href", "/finance?categoryId=cleaning");
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByTitle("Other (2 categories: Supplies, Taxes)")).toBeInTheDocument();
  });
});
