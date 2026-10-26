// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toastError, toastSuccess } from "@/components/toast";

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
    render(<BookingActions id={ID} status="inquiry" fromWebsite={false} currency="EUR" />);

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
    render(<BookingActions id={ID} status="inquiry" fromWebsite={false} currency="EUR" />);

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This booking cannot be confirmed: its dates are taken.");
    expect(within(alert).getByRole("link")).toHaveAttribute("href", `/bookings/${OTHER}`);
    expect(within(alert).getByRole("link")).toHaveTextContent(/^Booked by Bea Smith, 15/);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("cancels for the guest under the policy, or with the refund changed", async () => {
    const preview = {
      policy: { depositNonRefundable: true, depositAmountMinor: 22_000 },
      guest: { receivedMinor: 110_000, retainedMinor: 22_000, refundMinor: 88_000 },
      ownerRefundMinor: 110_000,
    };
    const fetchMock = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith("/cancellation") ? Response.json(preview) : Response.json({}),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<BookingActions id={ID} status="confirmed" fromWebsite={false} currency="EUR" />);

    await user.click(screen.getByRole("button", { name: "Cancel booking" }));
    const dialog = await screen.findByRole("dialog");
    const refund = await within(dialog).findByLabelText("Refund (EUR)");
    expect(refund).toHaveValue("880.00");
    expect(dialog).toHaveTextContent("the deposit of €220.00 is kept");

    // The owner cancelling: everything back.
    await user.click(within(dialog).getByRole("radio", { name: "You" }));
    expect(refund).toHaveValue("1100.00");
    await user.click(within(dialog).getByRole("radio", { name: "The guest" }));
    await user.clear(refund);
    await user.type(refund, "900");
    await user.click(within(dialog).getByRole("button", { name: "Cancel booking" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/bookings/${ID}/cancel`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ by: "guest", refundMinor: 90_000 }),
      }),
    );
  });

  it("offers no confirm on a confirmed booking", () => {
    render(<BookingActions id={ID} status="confirmed" fromWebsite={false} currency="EUR" />);
    expect(screen.queryByRole("button", { name: "Confirm booking" })).not.toBeInTheDocument();
  });

  it("reinstates a cancelled booking as an inquiry", async () => {
    const fetchMock = serve(Response.json({}));
    const user = userEvent.setup();
    render(<BookingActions id={ID} status="cancelled" fromWebsite={false} currency="EUR" />);

    expect(screen.queryByRole("button", { name: "Cancel booking" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reinstate as inquiry" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // Its own action (GitLab #135), not a status written by hand.
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/bookings/${ID}/reinstate`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("offers no hand confirm for a request from the website: it is accepted", () => {
    render(<BookingActions id={ID} status="inquiry" fromWebsite currency="EUR" />);
    expect(screen.queryByRole("button", { name: "Confirm booking" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept and reserve" })).toBeInTheDocument();
  });

  it("says why a booking can't be reinstated while money is held", async () => {
    serve(
      Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Validation failed.",
            fields: {
              status: [
                "cannot be reinstated while money is held: refund it first, or make a new booking",
              ],
            },
          },
        },
        { status: 422 },
      ),
    );
    const user = userEvent.setup();
    render(<BookingActions id={ID} status="cancelled" fromWebsite={false} currency="EUR" />);
    await user.click(screen.getByRole("button", { name: "Reinstate as inquiry" }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const [error, title] = vi.mocked(toastError).mock.calls[0]!;
    expect(title).toBe("Could not reinstate");
    expect((error as Error).message).toBe(
      "Cannot be reinstated while money is held: refund it first, or make a new booking",
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
