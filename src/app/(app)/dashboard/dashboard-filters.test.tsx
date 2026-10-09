// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardFilters } from "./dashboard-filters";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => vi.clearAllMocks());

const properties = [
  { id: "p1", name: "Lake House" },
  { id: "p2", name: "Sea View" },
];

function renderFilters(
  state: Partial<React.ComponentProps<typeof DashboardFilters>["state"]> = {},
) {
  render(
    <DashboardFilters
      state={{ preset: "this-month", from: "2026-10-01", until: "2026-10-31", ...state }}
      properties={properties}
    >
      <p>widgets</p>
    </DashboardFilters>,
  );
  return userEvent.setup();
}

describe("DashboardFilters", () => {
  it("switches presets through the URL, keeping the property", async () => {
    const user = renderFilters({ propertyId: "p1" });
    expect(screen.getByRole("radio", { name: "This month" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(screen.getByRole("radio", { name: "Last 12 months" }));
    expect(push).toHaveBeenCalledWith("/dashboard?preset=last-12-months&propertyId=p1", {
      scroll: false,
    });
  });

  it("chooses a property, including all of them", async () => {
    const user = renderFilters({ preset: "year-to-date", propertyId: "p1" });
    await user.selectOptions(screen.getByLabelText("Property"), "p2");
    await user.selectOptions(screen.getByLabelText("Property"), "");
    expect(push.mock.calls.map(([url]) => url)).toEqual([
      "/dashboard?preset=year-to-date&propertyId=p2",
      "/dashboard?preset=year-to-date",
    ]);
  });

  it("takes a custom range only once both dates are set and in order", async () => {
    const user = renderFilters();
    await user.click(screen.getByRole("radio", { name: "Custom" }));
    expect(push).not.toHaveBeenCalled();

    const from = screen.getByLabelText("From");
    const until = screen.getByLabelText("Until");
    await user.clear(from);
    await user.type(from, "2026-03-01");
    await user.clear(until);
    await user.type(until, "2026-02-01");
    expect(screen.getByRole("button", { name: "Show" })).toBeDisabled();

    await user.clear(until);
    await user.type(until, "2026-05-31");
    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(push).toHaveBeenCalledWith("/dashboard?from=2026-03-01&until=2026-05-31", {
      scroll: false,
    });
  });

  it("wraps the widgets", () => {
    renderFilters();
    expect(screen.getByText("widgets")).toBeInTheDocument();
  });
});
