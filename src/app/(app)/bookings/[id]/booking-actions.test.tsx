// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toastSuccess } from "@/components/toast";

import { BookingActions } from "./booking-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

const ID = "3c7d6f0e-1b2a-4c5d-8e9f-0a1b2c3d4e5f";
const OTHER = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function serve(response: Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("BookingActions", () => {
  it("confirms an inquiry", async () => {
    const fetchMock = serve(Response.json({}));
    const user = userEvent.setup();
    render(<BookingActions id={ID} status="inquiry" />);

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/bookings/${ID}`,
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "confirmed" }) }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Booking confirmed");
  });

  it("says clearly why an inquiry cannot be confirmed, linking what is in the way", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_input, init) =>
        init?.method === "PATCH"
          ? Response.json(
              {
                error: {
                  code: "conflict",
                  message: "Those dates overlap booking …",
                  conflicts: [
                    { kind: "booking", id: OTHER, start: "2026-07-15", end: "2026-07-20" },
                  ],
                },
              },
              { status: 409 },
            )
          : // The owner's own API names the guest in the way.
            Response.json({ id: OTHER, guest: { id: "g", name: "Bea Smith" } }),
      ),
    );
    const user = userEvent.setup();
    render(<BookingActions id={ID} status="inquiry" />);

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This booking cannot be confirmed: its dates are taken.");
    expect(within(alert).getByRole("link")).toHaveAttribute("href", `/bookings/${OTHER}`);
    expect(within(alert).getByRole("link")).toHaveTextContent(/^Booked by Bea Smith, 15/);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("cancels only after asking", async () => {
    const fetchMock = serve(Response.json({}));
    const user = userEvent.setup();
    render(<BookingActions id={ID} status="confirmed" />);

    await user.click(screen.getByRole("button", { name: "Cancel booking" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel booking" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/bookings/${ID}/cancel`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("offers no confirm on a confirmed booking", () => {
    render(<BookingActions id={ID} status="confirmed" />);
    expect(screen.queryByRole("button", { name: "Confirm booking" })).not.toBeInTheDocument();
  });

  it("reinstates a cancelled booking as an inquiry", async () => {
    const fetchMock = serve(Response.json({}));
    const user = userEvent.setup();
    render(<BookingActions id={ID} status="cancelled" />);

    expect(screen.queryByRole("button", { name: "Cancel booking" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reinstate as inquiry" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/bookings/${ID}`,
      expect.objectContaining({ body: JSON.stringify({ status: "inquiry" }) }),
    );
  });
});
