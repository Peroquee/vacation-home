// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DoubleBookingBanner } from "./double-booking-banner";

const issue = (id: string) => ({
  id,
  feed: { name: "Airbnb" },
  property: { name: "Lake House" },
  startDate: new Date("2026-07-14T00:00:00Z"),
  endDate: new Date("2026-07-18T00:00:00Z"),
});
const open = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("@/lib/google/sync-issues", () => ({ openDoubleBookings: async () => open.list }));

async function renderBanner() {
  render(<>{await DoubleBookingBanner()}</>);
}

describe("DoubleBookingBanner", () => {
  it("shows nothing without double bookings", async () => {
    open.list = [];
    await renderBanner();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names the platform, property and dates of a single one, linking to the review", async () => {
    open.list = [issue("i1")];
    await renderBanner();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /^Double booking: Airbnb has a stay at Lake House, 14\s–\s18 Jul 2026, on the dates of a confirmed booking here/,
    );
    expect(screen.getByRole("link", { name: "Review double bookings" })).toHaveAttribute(
      "href",
      "/settings#double-bookings",
    );
  });

  it("counts several", async () => {
    open.list = [issue("i1"), issue("i2")];
    await renderBanner();
    expect(screen.getByRole("alert")).toHaveTextContent(/^2 double bookings/);
  });
});
