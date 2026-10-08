// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toastError, toastSuccess } from "@/components/toast";

import { EraseGuestButton } from "./erase-guest-button";
import GuestPage from "./page";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

const ID = "0b9a0c8e-8a43-4c50-9a59-3f1f7c3b2d11";

const guests = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/lib/guests/service", () => ({ getGuest: async () => guests.current }));
vi.mock("@/lib/bookings/service", () => ({
  listGuestBookings: async () => [
    {
      id: "3c7d6f0e-1b2a-4c5d-8e9f-0a1b2c3d4e5f",
      checkIn: "2026-07-14",
      checkOut: "2026-07-18",
      status: "confirmed",
      totalAmountMinor: 78000,
      currency: "EUR",
      property: { id: "p", name: "Casa Azul" },
    },
  ],
  // The mocked rows are DTOs already.
  toDto: (row: unknown) => row,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const guest = {
  id: ID,
  name: "Ada Lovelace",
  email: "ada@example.test",
  phone: "+351 912 345 678",
  notes: null,
  purgedAt: null,
};

async function renderPage() {
  render(await GuestPage({ params: Promise.resolve({ id: ID }) } as PageProps<"/guests/[id]">));
}

describe("guest page", () => {
  it("shows contact details, stays and the erase action", async () => {
    guests.current = guest;
    await renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ada@example.test" })).toHaveAttribute(
      "href",
      "mailto:ada@example.test",
    );
    expect(screen.getByText("Casa Azul")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erase personal data" })).toBeInTheDocument();
  });

  it("shows an erased guest anonymised, with no actions", async () => {
    guests.current = {
      ...guest,
      name: "Deleted guest",
      email: null,
      phone: null,
      purgedAt: new Date("2026-09-01T10:00:00Z"),
    };
    await renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Deleted guest" })).toBeInTheDocument();
    expect(screen.getByText(/Erased on Sep 1, 2026/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("ada@example.test")).not.toBeInTheDocument();
  });

  it("is a 404 for an unknown or malformed id", async () => {
    guests.current = null;
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(
      GuestPage({ params: Promise.resolve({ id: "nope" }) } as PageProps<"/guests/[id]">),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("EraseGuestButton", () => {
  function serve(response: Response) {
    const fetchMock = vi.fn<typeof fetch>(async () => response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  async function eraseAndConfirm() {
    const user = userEvent.setup();
    render(<EraseGuestButton id={ID} name="Ada Lovelace" />);
    await user.click(screen.getByRole("button", { name: "Erase personal data" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Erase Ada Lovelace's personal data?",
    });
    expect(dialog).toHaveTextContent("This cannot be undone.");
    expect(dialog).toHaveTextContent("The bookings themselves remain, anonymised");
    await user.click(within(dialog).getByRole("button", { name: "Erase permanently" }));
  }

  it("asks first, then erases with the id repeated as confirmation", async () => {
    const fetchMock = serve(Response.json({ outcome: "anonymised", guest: {} }));
    await eraseAndConfirm();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/guests/${ID}/purge`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ confirm: ID }) }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Personal data erased");
    expect(push).not.toHaveBeenCalled();
  });

  it("does nothing when the dialog is dismissed", async () => {
    const fetchMock = serve(Response.json({}));
    const user = userEvent.setup();
    render(<EraseGuestButton id={ID} name="Ada Lovelace" />);
    await user.click(screen.getByRole("button", { name: "Erase personal data" }));
    await user.click(await screen.findByRole("button", { name: "Keep data" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves the page when a guest without bookings is deleted", async () => {
    serve(Response.json({ outcome: "deleted" }));
    await eraseAndConfirm();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/bookings"));
  });

  it("keeps the dialog open and reports a failure", async () => {
    serve(
      Response.json({ error: { code: "not_found", message: "Guest not found." } }, { status: 404 }),
    );
    await eraseAndConfirm();

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
