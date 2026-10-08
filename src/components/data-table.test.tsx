// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { type Column, DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/states";

type Payment = { id: string; guest: string; amount: string };

const columns: Column<Payment>[] = [
  { id: "guest", header: "Guest", cell: (p) => p.guest },
  { id: "amount", header: "Amount", cell: (p) => p.amount, align: "end" },
];

describe("DataTable", () => {
  it("renders a header and one row per item", () => {
    render(
      <DataTable
        caption="Payments"
        columns={columns}
        rows={[
          { id: "1", guest: "Ada", amount: "€120.00" },
          { id: "2", guest: "Grace", amount: "€80.00" },
        ]}
        rowKey={(p) => p.id}
        empty={null}
      />,
    );

    const table = screen.getByRole("table", { name: "Payments" });
    const [header, ...rows] = within(table).getAllByRole("row");
    expect(
      within(header!)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Guest", "Amount"]);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("€120.00")).toHaveClass("text-right");
  });

  it("renders the empty state instead of an empty table", () => {
    render(
      <DataTable
        caption="Payments"
        columns={columns}
        rows={[]}
        rowKey={(p) => p.id}
        empty={<EmptyState title="No payments yet" />}
      />,
    );

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No payments yet");
  });
});
