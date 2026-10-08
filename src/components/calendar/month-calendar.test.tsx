// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { type CalendarProperty, MonthCalendar } from "./month-calendar";

const lake: CalendarProperty = {
  property: { id: "p1", name: "Lake House", color: "#0f766e" },
  bookings: [
    {
      id: "out",
      checkIn: "2026-07-10",
      checkOut: "2026-07-15",
      status: "confirmed",
      source: "direct",
      guest: { id: "g1", name: "Ada Lovelace" },
    },
    {
      id: "in",
      checkIn: "2026-07-15",
      checkOut: "2026-07-17",
      status: "inquiry",
      source: "airbnb",
      guest: { id: "g2", name: "Grace Hopper" },
    },
    {
      // Crosses into August.
      id: "edge",
      checkIn: "2026-07-30",
      checkOut: "2026-08-03",
      status: "confirmed",
      source: "direct",
      guest: { id: "g3", name: "Alan Turing" },
    },
  ],
  blocks: [
    {
      id: "k1",
      startDate: "2026-07-20",
      endDate: "2026-07-22",
      reason: "Painting",
      origin: "manual",
    },
  ],
};

function renderCalendar(month = "2026-07", onMonthChange = vi.fn()) {
  render(
    <MonthCalendar
      month={month}
      weekStart={1}
      today="2026-07-08"
      calendars={[lake]}
      onMonthChange={onMonthChange}
      bookingHref={(id) => `/bookings/${id}`}
    />,
  );
  return { user: userEvent.setup(), onMonthChange };
}

describe("MonthCalendar", () => {
  it("shows the month with leading and trailing days and marks today", () => {
    renderCalendar();
    expect(screen.getByRole("heading", { name: "July 2026" })).toBeInTheDocument();
    // July 2026 starts on a Wednesday: Monday 29 June leads the first week.
    const days = document.querySelectorAll("time");
    expect(days[0]).toHaveAttribute("dateTime", "2026-06-29");
    expect(days[days.length - 1]).toHaveAttribute("dateTime", "2026-08-02");
    expect(document.querySelector('[aria-current="date"]')).toHaveAttribute(
      "dateTime",
      "2026-07-08",
    );
  });

  it("draws a turnover as two stays meeting mid-day, each linking to its booking", () => {
    renderCalendar();
    // Ada's stay spans two weeks, so it has a bar in each.
    const leaving = screen.getAllByRole("link", { name: /^Ada Lovelace, Lake House, confirmed/ });
    const arriving = screen.getByRole("link", { name: /^Grace Hopper, Lake House, inquiry/ });
    expect(leaving).toHaveLength(2);
    expect(leaving[0]).toHaveAttribute("href", "/bookings/out");
    expect(arriving).toHaveAttribute("href", "/bookings/in");
    // Week of 13 July: Ada leaves the morning of the 15th (up to line 6),
    // Grace arrives that afternoon (from line 6): they touch, never overlap.
    expect(leaving[1]).toHaveAttribute("data-from-line", "1");
    expect(leaving[1]).toHaveAttribute("data-to-line", "6");
    expect(arriving).toHaveAttribute("data-from-line", "6");
    expect(arriving).toHaveAttribute("data-to-line", "10");
  });

  it("shows a stay crossing the month boundary in both months", () => {
    renderCalendar("2026-07");
    expect(screen.getAllByRole("link", { name: /^Alan Turing/ }).length).toBeGreaterThan(0);
    cleanup();
    renderCalendar("2026-08");
    expect(screen.getAllByRole("link", { name: /^Alan Turing/ }).length).toBeGreaterThan(0);
  });

  it("draws blocks without a link", () => {
    renderCalendar();
    expect(screen.getByRole("img", { name: /^Blocked: Painting, Lake House/ })).toBeInTheDocument();
  });

  it("reports navigation without fetching anything itself", async () => {
    const { user, onMonthChange } = renderCalendar();
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Month" }), "12");
    await user.selectOptions(screen.getByRole("combobox", { name: "Year" }), "2027");
    expect(onMonthChange.mock.calls.map(([month]) => month)).toEqual([
      "2026-08",
      "2026-06",
      "2026-12",
      "2027-07",
    ]);
  });

  it("goes back to today's month", async () => {
    const { user, onMonthChange } = renderCalendar("2026-11");
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(onMonthChange).toHaveBeenCalledWith("2026-07");
  });

  it("has a legend for properties and statuses", () => {
    renderCalendar();
    expect(screen.getByRole("list", { name: "Properties" })).toHaveTextContent("Lake House");
    expect(screen.getByRole("list", { name: "Status" })).toHaveTextContent(
      /Confirmed.*Inquiry.*Blocked/,
    );
  });
});

describe("MonthCalendar range selection", () => {
  const priced: CalendarProperty = {
    ...lake,
    property: {
      ...lake.property,
      currency: "EUR",
      defaultNightlyRateMinor: 10000,
      defaultCleaningFeeMinor: 5000,
    },
  };

  function renderSelectable() {
    const onSelectRange = vi.fn();
    render(
      <MonthCalendar
        month="2026-07"
        weekStart={1}
        today="2026-07-08"
        calendars={[priced]}
        onMonthChange={vi.fn()}
        onSelectRange={onSelectRange}
      />,
    );
    return { user: userEvent.setup(), onSelectRange };
  }

  const day = (name: string) => screen.getByRole("button", { name });
  // 23 to 26 July 2026 is free; Ada stays 10 to 15 July.
  const THU_23 = "Thursday, July 23, 2026";
  const SUN_26 = "Sunday, July 26, 2026";
  const free = { propertyId: "p1", checkIn: "2026-07-23", checkOut: "2026-07-26" };

  it("selects by dragging, forwards or backwards", async () => {
    const { user, onSelectRange } = renderSelectable();
    await user.pointer([
      { keys: "[MouseLeft>]", target: day(THU_23) },
      { target: day(SUN_26) },
      { keys: "[/MouseLeft]", target: day(SUN_26) },
    ]);
    await user.pointer([
      { keys: "[MouseLeft>]", target: day(SUN_26) },
      { target: day(THU_23) },
      { keys: "[/MouseLeft]", target: day(THU_23) },
    ]);
    expect(onSelectRange.mock.calls).toEqual([[free], [free]]);
  });

  it("selects by tapping the first and the last day", async () => {
    const { user, onSelectRange } = renderSelectable();
    await user.click(day(THU_23));
    expect(screen.getByText(/Now pick the last day/)).toBeInTheDocument();
    await user.click(day(SUN_26));
    expect(onSelectRange).toHaveBeenCalledWith(free);
  });

  it("selects with the keyboard: shift and arrows extend, Enter finishes", async () => {
    const { user, onSelectRange } = renderSelectable();
    day(THU_23).focus();
    await user.keyboard("{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}");
    expect(day(SUN_26)).toHaveFocus();
    // Three nights at €100 plus a €50 cleaning fee.
    expect(screen.getByText(/3 nights · €350\.00/)).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(onSelectRange).toHaveBeenCalledWith(free);
  });

  it("cancels with Escape", async () => {
    const { user, onSelectRange } = renderSelectable();
    await user.click(day(THU_23));
    await user.keyboard("{Escape}");
    expect(screen.getByText(/Drag across days/)).toBeInTheDocument();
    await user.click(day(SUN_26));
    expect(onSelectRange).not.toHaveBeenCalled();
  });

  it("turns red and opens nothing when the range overlaps a stay", async () => {
    const { user, onSelectRange } = renderSelectable();
    await user.click(day("Monday, July 13, 2026"));
    await user.click(day("Thursday, July 16, 2026"));

    expect(onSelectRange).not.toHaveBeenCalled();
    const hint = screen.getByText(/Not available: Booked by Ada Lovelace/);
    expect(hint).toHaveClass("text-destructive");
    expect(hint).toHaveTextContent("Change the dates, or press Escape.");
  });

  it("is read-only without onSelectRange", async () => {
    renderCalendar();
    expect(screen.queryByText(/Drag across days/)).not.toBeInTheDocument();
  });
});
