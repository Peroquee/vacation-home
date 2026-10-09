import { describe, expect, it } from "vitest";

import { breakdownRows, type CategoryShare } from "./breakdown";

const row = (name: string, amountMinor: number, total: number): CategoryShare => ({
  categoryId: name.toLowerCase(),
  name,
  color: "#64748b",
  amountMinor,
  share: amountMinor / total,
});

describe("breakdownRows", () => {
  it("keeps sizeable categories, largest first", () => {
    const rows = breakdownRows([row("Cleaning", 300, 1000), row("Utilities", 700, 1000)]);
    expect(rows.map((r) => [r.kind, r.name])).toEqual([
      ["category", "Utilities"],
      ["category", "Cleaning"],
    ]);
  });

  it("folds slivers below the threshold into Other", () => {
    const total = 10_000;
    const rows = breakdownRows([
      row("Cleaning", 6000, total),
      row("Utilities", 3600, total),
      row("Supplies", 250, total),
      row("Taxes", 150, total),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Cleaning", "Utilities", "Other"]);
    const other = rows.at(-1)!;
    expect(other).toMatchObject({ kind: "other", amountMinor: 400, share: 0.04 });
    expect(other.kind === "other" && other.categories.map((c) => c.name)).toEqual([
      "Supplies",
      "Taxes",
    ]);
  });

  it("caps the number of categories of their own", () => {
    const rows = breakdownRows(
      Array.from({ length: 10 }, (_, i) => row(`C${i}`, 100 + i, 1045)),
      { max: 7 },
    );
    expect(rows).toHaveLength(8);
    expect(rows.at(-1)).toMatchObject({ kind: "other" });
  });

  it("keeps a single small category under its own name", () => {
    const rows = breakdownRows([row("Cleaning", 980, 1000), row("Taxes", 20, 1000)]);
    expect(rows.map((r) => [r.kind, r.name])).toEqual([
      ["category", "Cleaning"],
      ["category", "Taxes"],
    ]);
  });

  it("leaves out categories with nothing spent", () => {
    expect(breakdownRows([row("Cleaning", 0, 1)])).toEqual([]);
  });
});
