// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PropertyChoice } from "@/lib/bookings/form";

import { BookingForm, type EditableBooking } from "./booking-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/components/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

// The guest typeahead has its own concerns; here a plain button picks Ada.
// The form labels it "Guest", which is its accessible name.
const ada = { id: "0b9a0c8e-8a43-4c50-9a59-3f1f7c3b2d11", name: "Ada Lovelace", email: null };
vi.mock("./guest-picker", () => ({
  GuestPicker: ({
    id,
    onChange,
    value,
  }: {
    id: string;
    onChange: (guest: typeof ada) => void;
    value: typeof ada | null;
  }) => (
    <button type="button" id={id} onClick={() => onChange(ada)}>
      {value ? value.name : "Pick Ada"}
    </button>
  ),
}));

const property: PropertyChoice = {
  id: "6f1c2a52-6f0c-4c4e-9d43-3a0e4f1b9a11",
  name: "Casa Azul",
  currency: "EUR",
  defaultCleaningFeeMinor: 6000,
  pricing: {
    currency: "EUR",
    defaultNightlyRateMinor: 18000,
    defaultCleaningFeeMinor: 6000,
    // From 16 July: the summer rate.
    seasons: [
      {
        name: "Hauptsaison",
        startMonth: 7,
        startDay: 16,
        endMonth: 8,
        endDay: 31,
        year: null,
        rateMinor: 20000,
      },
    ],
  },
};

const CREATED_ID = "9d2f8a51-3c4b-4e6f-8a7b-1c2d3e4f5a6b";

type Calendar = { bookings: unknown[]; blocks: unknown[] };
const free: Calendar = { bookings: [], blocks: [] };

const isCheck = (url: unknown) =>
  String(url).startsWith("/api/availability") || String(url).includes("/booking-rules/check");

/**
 * Answers the availability check with `calendar`, the booking rules check
 * with `warnings`, and saves with `save`.
 */
function serve(calendar: Calendar, save?: Response, warnings: unknown[] = []) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    if (String(input).startsWith("/api/availability")) {
      return Response.json({ properties: [{ ...calendar, days: [] }] });
    }
    if (String(input).includes("/booking-rules/check")) return Response.json({ warnings });
    return save ?? Response.json({ id: CREATED_ID }, { status: 201 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function saveCall(fetchMock: ReturnType<typeof serve>) {
  const call = fetchMock.mock.calls.find(([url]) => !isCheck(url));
  return call && { url: String(call[0]), init: call[1]!, body: JSON.parse(String(call[1]!.body)) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function fillStay(
  user: ReturnType<typeof userEvent.setup>,
  checkIn: string,
  checkOut: string,
) {
  await user.type(screen.getByLabelText("Check-in"), checkIn);
  const out = screen.getByLabelText("Check-out");
  await user.clear(out);
  await user.type(out, checkOut);
}

describe("BookingForm", () => {
  it("prices the stay by the property's seasons, line by line, as the API will", async () => {
    serve(free);
    const user = userEvent.setup();
    render(<BookingForm properties={[property]} />);

    // No rate of its own: the seasons price the nights.
    expect(screen.getByLabelText("Own nightly rate (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Cleaning fee")).toHaveValue("60.00");
    await fillStay(user, "2026-07-14", "2026-07-18");

    expect(screen.getByText(/^2 nights × €180\.00/)).toHaveTextContent("standard rate");
    expect(screen.getByText(/^2 nights × €200\.00/)).toHaveTextContent("Hauptsaison");
    // 360 + 400 + 60 cleaning.
    expect(screen.getByText("€820.00")).toBeInTheDocument();
    expect(await screen.findByText("These dates are available.")).toBeInTheDocument();
  });

  it("warns about the property's booking rules, without blocking the save", async () => {
    const fetchMock = serve(free, undefined, [
      { field: "checkOut", rule: "minNights", message: "the stay must be at least 3 nights" },
    ]);
    const user = userEvent.setup();
    render(<BookingForm properties={[property]} />);
    await fillStay(user, "2026-07-10", "2026-07-12");

    const warning = await screen.findByText(/Outside this property's booking rules/);
    expect(warning.parentElement).toHaveTextContent("Check-out the stay must be at least 3 nights");
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).startsWith(
          `/api/properties/${property.id}/booking-rules/check?checkIn=2026-07-10&checkOut=2026-07-12`,
        ),
      ),
    ).toBe(true);
  });

  it("shows a taken range before submit", async () => {
    serve({
      bookings: [
        {
          id: "b1",
          checkIn: "2026-07-15",
          checkOut: "2026-07-20",
          status: "confirmed",
          source: "direct",
          guest: { id: "g2", name: "Grace Hopper" },
        },
      ],
      blocks: [],
    });
    const user = userEvent.setup();
    render(<BookingForm properties={[property]} />);
    await user.selectOptions(screen.getByLabelText("Status"), "confirmed");
    await fillStay(user, "2026-07-14", "2026-07-18");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("These dates are not available.");
    expect(alert).toHaveTextContent("Booked by Grace Hopper");
  });

  it("explains a changeover missed by one night and applies the fix", async () => {
    serve({
      bookings: [
        {
          id: "b1",
          checkIn: "2026-07-10",
          checkOut: "2026-07-15",
          status: "confirmed",
          source: "direct",
          guest: { id: "g2", name: "Grace Hopper" },
        },
      ],
      blocks: [],
    });
    const user = userEvent.setup();
    render(<BookingForm properties={[property]} />);
    await user.selectOptions(screen.getByLabelText("Status"), "confirmed");
    await fillStay(user, "2026-07-14", "2026-07-18");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Arrive on 15 July 2026 instead/);
    expect(within(alert).getByRole("link", { name: /Booked by Grace Hopper/ })).toHaveAttribute(
      "href",
      "/bookings/b1",
    );
    await user.click(within(alert).getByRole("button", { name: "Use this check-in" }));
    expect(screen.getByLabelText("Check-in")).toHaveValue("2026-07-15");
    expect(await screen.findByText("These dates are available.")).toBeInTheDocument();
  });

  it("creates a booking in minor units", async () => {
    const fetchMock = serve(free);
    const user = userEvent.setup();
    render(<BookingForm properties={[property]} />);
    await user.click(screen.getByRole("button", { name: "Guest" }));
    await fillStay(user, "2026-07-14", "2026-07-18");
    await user.type(screen.getByLabelText("Own nightly rate (optional)"), "199.5");
    await user.click(screen.getByRole("button", { name: "Add booking" }));

    // Straight to the new booking's detail page.
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/bookings/${CREATED_ID}`));
    const save = saveCall(fetchMock)!;
    expect(save.url).toBe("/api/bookings");
    expect(save.init.method).toBe("POST");
    expect(save.body).toMatchObject({
      propertyId: property.id,
      guestId: ada.id,
      checkIn: "2026-07-14",
      checkOut: "2026-07-18",
      nightlyRateMinor: 19950,
      cleaningFeeMinor: 6000,
    });
    expect(save.body).not.toHaveProperty("totalAmountMinor");
  });

  it("shows the API's 409 inline", async () => {
    serve(
      free,
      Response.json(
        {
          error: {
            code: "conflict",
            message: "Those dates overlap a block (2026-07-15 to 2026-07-16).",
            conflicts: [
              {
                kind: "block",
                id: "k1",
                start: "2026-07-15",
                end: "2026-07-16",
                reason: "Painting",
                origin: "manual",
              },
            ],
          },
        },
        { status: 409 },
      ),
    );
    const user = userEvent.setup();
    render(<BookingForm properties={[property]} />);
    await user.click(screen.getByRole("button", { name: "Guest" }));
    await fillStay(user, "2026-07-14", "2026-07-18");
    await user.click(screen.getByRole("button", { name: "Add booking" }));

    expect(await screen.findByText(/Blocked \(Painting\)/)).toBeInTheDocument();
    expect(screen.getByText("Those dates are no longer available.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the API's 422 per field and focuses the first one", async () => {
    serve(
      free,
      Response.json(
        {
          error: {
            code: "validation_failed",
            message: "The request has invalid fields.",
            fields: { guestCount: ["is too many"] },
          },
        },
        { status: 422 },
      ),
    );
    const user = userEvent.setup();
    render(<BookingForm properties={[property]} />);
    await user.click(screen.getByRole("button", { name: "Guest" }));
    await fillStay(user, "2026-07-14", "2026-07-18");
    await user.click(screen.getByRole("button", { name: "Add booking" }));

    expect(await screen.findByText("Guests is too many")).toBeInTheDocument();
    const guests = screen.getByLabelText("Guests");
    expect(guests).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(guests).toHaveFocus());
  });

  it("says what is missing without calling the API", async () => {
    const fetchMock = serve(free);
    const user = userEvent.setup();
    render(<BookingForm properties={[property]} />);
    await user.click(screen.getByRole("button", { name: "Add booking" }));

    expect(await screen.findByText(/Guest is required/)).toBeInTheDocument();
    expect(screen.getByText("Check-in is required")).toBeInTheDocument();
    expect(saveCall(fetchMock)).toBeUndefined();
  });

  it("edits a booking and hands a manual total back to the calculation", async () => {
    const fetchMock = serve(free, Response.json({}));
    const booking = {
      id: "3c7d6f0e-1b2a-4c5d-8e9f-0a1b2c3d4e5f",
      propertyId: property.id,
      property: { id: property.id, name: property.name },
      guestId: ada.id,
      guest: ada,
      checkIn: "2026-07-14",
      checkOut: "2026-07-18",
      nights: 4,
      status: "inquiry",
      source: "airbnb",
      guestCount: 2,
      nightlyRateMinor: 15000,
      cleaningFeeMinor: 5000,
      totalAmountMinor: 60000,
      totalIsManual: true,
      currency: "EUR",
      notes: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as EditableBooking;
    const user = userEvent.setup();
    render(<BookingForm properties={[property]} booking={booking} />);

    expect(screen.getByLabelText("Property")).toBeDisabled();
    expect(screen.getByLabelText("Total")).toHaveValue("600.00");
    await user.click(screen.getByRole("checkbox", { name: "Set the total by hand" }));
    await user.click(screen.getByRole("button", { name: "Save booking" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/bookings/${booking.id}`));
    const save = saveCall(fetchMock)!;
    expect(save.url).toBe(`/api/bookings/${booking.id}`);
    expect(save.init.method).toBe("PATCH");
    expect(save.body).not.toHaveProperty("propertyId");
    expect(save.body).toMatchObject({ totalAmountMinor: null, nightlyRateMinor: 15000 });
  });
});
