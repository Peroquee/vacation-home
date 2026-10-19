// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { publicNights } from "@/lib/booking-rules/public-nights";
import { DEFAULT_RULES } from "@/lib/booking-rules/rules";

import messages from "../../../../../messages/en-GB.json";
import { StayPicker } from "./stay-picker";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
afterEach(() => vi.clearAllMocks());

/** July 2026, booked 10–12, minimum two nights. */
function serve() {
  fetchMock.mockImplementation(async (input) => {
    const params = new URL(String(input), "http://test").searchParams;
    const from = params.get("from")!;
    const to = params.get("to")!;
    const rules = { ...DEFAULT_RULES, minNights: 2 };
    const taken = new Set(["2026-07-10", "2026-07-11"]);
    return Response.json({
      from,
      to,
      minNights: 2,
      maxNights: null,
      pricing: {
        currency: "EUR",
        defaultNightlyRateMinor: 10_000,
        defaultCleaningFeeMinor: 2_500,
        seasons: [],
        discounts: [],
        touristTax: null,
      },
      nights: publicNights({ from, to }, taken, rules, "2026-07-01"),
    });
  });
}

function renderPicker() {
  render(
    <NextIntlClientProvider locale="en-GB" messages={messages}>
      <StayPicker
        slug="lake-house"
        firstMonth="2026-07"
        maxGuests={4}
        cancellation={{
          depositNonRefundable: true,
          depositPercent: 20,
          depositFixedMinor: null,
          schedule: null,
        }}
      />
    </NextIntlClientProvider>,
  );
  return userEvent.setup();
}

const day = (date: string) => document.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)!;

describe("StayPicker", () => {
  it("asks the public endpoint for the shown months", async () => {
    serve();
    renderPicker();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(
      /^\/api\/public\/properties\/lake-house\/availability\?from=2026-06-29&to=/,
    );
    expect(await screen.findByText(/The minimum stay is 2 nights\./)).toBeInTheDocument();
  });

  it("offers only allowed arrivals and departures, then shows the estimate", async () => {
    serve();
    const user = renderPicker();
    await waitFor(() => expect(day("2026-07-05")).toBeEnabled());
    // Taken, and too short a gap before the booking.
    expect(day("2026-07-10")).toBeDisabled();
    expect(day("2026-07-09")).toBeDisabled();

    await user.click(day("2026-07-05"));
    expect(screen.getByText("Now choose your departure day.")).toBeInTheDocument();
    expect(day("2026-07-10")).toHaveAccessibleName(/possible departure/);
    expect(day("2026-07-06")).not.toHaveAccessibleName(/possible departure/);
    await user.click(day("2026-07-08"));

    const estimate = screen.getByTestId("stay-estimate");
    expect(estimate).toHaveTextContent("3 nights × €100.00 · standard rate€300.00");
    expect(estimate).toHaveTextContent("Cleaning fee€25.00");
    expect(estimate).toHaveTextContent("Total€325.00");
    await user.click(screen.getByRole("button", { name: "Choose other dates" }));
    expect(screen.queryByTestId("stay-estimate")).not.toBeInTheDocument();
  });

  it("says so when the dates cannot be loaded", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    renderPicker();
    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
  });
});
