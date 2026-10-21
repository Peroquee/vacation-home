// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FinanceTabs } from "./finance-tabs";

const path = vi.hoisted(() => ({ value: "/finance" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.value }));

// GitLab #130: the recurring costs are a tab of Finance, not a button to find.
describe("FinanceTabs", () => {
  const current = () =>
    within(screen.getByRole("navigation", { name: "Finance" }))
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page")
      .map((link) => link.textContent);

  it("lists every part of Finance, with the recurring costs", () => {
    render(<FinanceTabs />);
    const links = within(screen.getByRole("navigation", { name: "Finance" })).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Ledger", "/finance"],
      ["Recurring costs", "/finance/recurring"],
      ["Kurtaxe", "/finance/tourist-tax"],
      ["Categories", "/finance/categories"],
    ]);
    expect(current()).toEqual(["Ledger"]);
  });

  it.each([
    ["/finance/recurring", "Recurring costs"],
    ["/finance/categories", "Categories"],
    ["/finance/import", "Ledger"],
  ])("on %s marks %s", (pathname, tab) => {
    path.value = pathname;
    render(<FinanceTabs />);
    expect(current()).toEqual([tab]);
  });
});
