// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { categoriesOfType } from "@/lib/finance/ledger";

import { TypeCategoryFilter } from "./type-category-filter";

// The ledger filter (GitLab #129), where the report came from: "Type
// expense, and income categories can still be chosen."
const categories = [
  { id: "c-clean", name: "Cleaning", type: "expense" as const },
  { id: "c-util", name: "Utilities", type: "expense" as const },
  { id: "c-rent", name: "Booking income", type: "income" as const },
];

function renderFilter(props: Partial<React.ComponentProps<typeof TypeCategoryFilter>> = {}) {
  render(
    <form aria-label="Filters">
      <TypeCategoryFilter
        categories={categories}
        type={undefined}
        categoryId={undefined}
        {...props}
      />
    </form>,
  );
  const offered = () =>
    within(screen.getByLabelText("Category"))
      .getAllByRole("option")
      .map((option) => option.textContent);
  return { user: userEvent.setup(), offered };
}

describe("the ledger's type and category filter", () => {
  it("offers every category, typed, until a type is chosen; then only that type's", async () => {
    const { user, offered } = renderFilter();
    expect(offered()).toEqual([
      "Any category",
      "Cleaning (expense)",
      "Utilities (expense)",
      "Booking income (income)",
    ]);
    await user.selectOptions(screen.getByLabelText("Type"), "expense");
    expect(offered()).toEqual(["Any category", "Cleaning", "Utilities"]);
    await user.selectOptions(screen.getByLabelText("Type"), "income");
    expect(offered()).toEqual(["Any category", "Booking income"]);
  });

  it("clears a category of the other type when the type changes, and keeps one that fits", async () => {
    const { user } = renderFilter();
    const category = screen.getByLabelText("Category");
    await user.selectOptions(category, "c-rent");
    await user.selectOptions(screen.getByLabelText("Type"), "expense");
    expect(category).toHaveValue("");
    // Not restored on the way back.
    await user.selectOptions(screen.getByLabelText("Type"), "income");
    expect(category).toHaveValue("");

    await user.selectOptions(category, "c-rent");
    await user.selectOptions(screen.getByLabelText("Type"), "");
    expect(category).toHaveValue("c-rent");
    // The form sends what is shown.
    const form = screen.getByRole("form", { name: "Filters" }) as HTMLFormElement;
    expect(Object.fromEntries(new FormData(form))).toEqual({ type: "", categoryId: "c-rent" });
  });

  it("starts without a category of the other type from the URL", () => {
    renderFilter({ type: "expense", categoryId: "c-rent" });
    expect(screen.getByLabelText("Category")).toHaveValue("");
    expect(screen.getByLabelText("Type")).toHaveValue("expense");
  });
});

describe("categoriesOfType", () => {
  it("drops the other type's categories, keeps unknown ones and everything without a type", () => {
    expect(categoriesOfType("c-rent", "expense", categories)).toBeUndefined();
    expect(categoriesOfType("c-clean,c-rent", "expense", categories)).toBe("c-clean");
    expect(categoriesOfType("c-hidden", "expense", categories)).toBe("c-hidden");
    expect(categoriesOfType("c-rent", undefined, categories)).toBe("c-rent");
    expect(categoriesOfType(undefined, "income", categories)).toBeUndefined();
  });
});
