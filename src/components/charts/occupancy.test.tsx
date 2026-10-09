// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { heatmap } from "@/lib/dashboard/occupancy";

import { OccupancyChart } from "./occupancy-chart";
import { OccupancyHeatmap } from "./occupancy-heatmap";

beforeAll(() => {
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
  { month: "2026-06", rate: 0.5, booked: 15, available: 30, priorRate: 0.2 },
  // Fully blocked: no available nights, so no rate rather than 0%.
  { month: "2026-07", rate: null, booked: 0, available: 0, priorRate: 0.4 },
];

describe("OccupancyChart", () => {
  it("adds the year before on request, to the legend and the table", async () => {
    render(<OccupancyChart months={months} />);
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(legend).toHaveTextContent("Occupancy");
    expect(legend).not.toHaveTextContent("The year before");

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Compare with the year before" }));
    expect(legend).toHaveTextContent("The year before");

    await user.click(screen.getByText("Show the figures as a table"));
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      "June 202615 of 3050%20%",
      "July 20260 of 0–40%",
    ]);
  });

  it("offers no comparison without figures from the year before", () => {
    render(<OccupancyChart months={months.map((m) => ({ ...m, priorRate: null }))} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("OccupancyHeatmap", () => {
  const data = heatmap({ start: "2026-07-01", end: "2026-08-01" }, [
    {
      days: Array.from({ length: 31 }, (_, i) => ({
        date: `2026-07-${String(i + 1).padStart(2, "0")}`,
        status: i < 10 ? "booked" : "available",
      })),
    },
  ]);

  it("says each month's figure in words", () => {
    render(<OccupancyHeatmap months={data} properties={1} />);
    expect(
      screen.getByRole("listitem", { name: "Jul 2026: booked on 10 of 31 nights" }),
    ).toBeInTheDocument();
    expect(screen.getByTitle("1 Jul 2026: booked")).toBeInTheDocument();
    expect(screen.getByTitle("31 Jul 2026: free")).toBeInTheDocument();
  });

  it("counts properties when there are several", () => {
    render(<OccupancyHeatmap months={data} properties={3} />);
    expect(screen.getByTitle("1 Jul 2026: 1 of 3 properties booked")).toBeInTheDocument();
    expect(screen.getByText("All 3 booked")).toBeInTheDocument();
  });
});
