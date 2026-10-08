// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CalendarProperty } from "@/components/calendar/month-calendar";

import { CalendarView } from "./calendar-view";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/components/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const lake: CalendarProperty = {
  property: { id: "p1", name: "Lake House", color: "#0f766e" },
  bookings: [
    {
      id: "ada",
      checkIn: "2026-07-10",
      checkOut: "2026-07-15",
      status: "confirmed",
      source: "direct",
      guest: { id: "g1", name: "Ada Lovelace" },
    },
  ],
  blocks: [
    {
      id: "paint",
      startDate: "2026-07-20",
      endDate: "2026-07-22",
      reason: "Painting",
      origin: "manual",
    },
    {
      id: "gcal",
      startDate: "2026-07-27",
      endDate: "2026-07-29",
      reason: "Family",
      origin: "google",
    },
  ],
};

function renderView() {
  render(<CalendarView month="2026-07" weekStart={1} today="2026-07-08" calendars={[lake]} />);
  return userEvent.setup();
}

/** A fetch that answers only when the test says so. */
function heldFetch() {
  let answer!: (response: Response) => void;
  const fetchMock = vi.fn<typeof fetch>(
    () => new Promise<Response>((resolve) => (answer = resolve)),
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, answer: (response: Response) => answer(response) };
}

async function selectFree(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Thursday, July 23, 2026" }));
  await user.click(screen.getByRole("button", { name: "Sunday, July 26, 2026" }));
  return screen.findByRole("dialog");
}

describe("CalendarView", () => {
  it("offers a new booking or a block for a selected range", async () => {
    const user = renderView();
    const dialog = await selectFree(user);

    expect(within(dialog).getByRole("link", { name: "New booking" })).toHaveAttribute(
      "href",
      "/bookings/new?propertyId=p1&checkIn=2026-07-23&checkOut=2026-07-26",
    );
    expect(within(dialog).getByRole("button", { name: "Block dates" })).toBeInTheDocument();
  });

  it("shows a new block at once and keeps it once saved", async () => {
    const { fetchMock, answer } = heldFetch();
    const user = renderView();
    const dialog = await selectFree(user);
    await user.type(within(dialog).getByLabelText("Reason (optional)"), "Plumber");
    await user.click(within(dialog).getByRole("button", { name: "Block dates" }));

    // On screen before the server has answered.
    expect(screen.getByRole("img", { name: /^Blocked: Plumber, .*saving$/ })).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({
      propertyId: "p1",
      startDate: "2026-07-23",
      endDate: "2026-07-26",
      reason: "Plumber",
    });

    answer(Response.json({ id: "new" }, { status: 201 }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("rolls a refused block back, leaving no phantom bar, and rings what is in the way", async () => {
    const { answer } = heldFetch();
    const user = renderView();
    const dialog = await selectFree(user);
    await user.click(within(dialog).getByRole("button", { name: "Block dates" }));
    expect(screen.getByRole("img", { name: /saving$/ })).toBeInTheDocument();

    // Someone confirmed a booking for those dates in the meantime.
    answer(
      Response.json(
        {
          error: {
            code: "conflict",
            message: "Those dates overlap booking ada.",
            reason: "overlap",
            conflicts: [{ kind: "booking", id: "ada", start: "2026-07-10", end: "2026-07-15" }],
          },
        },
        { status: 409 },
      ),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("could not be blocked: a confirmed booking is in the way");
    expect(
      within(alert).getByRole("link", { name: /Open: Booked by Ada Lovelace/ }),
    ).toHaveAttribute("href", "/bookings/ada");
    expect(screen.queryByRole("img", { name: /saving$/ })).not.toBeInTheDocument();
    for (const bar of screen.getAllByRole("link", { name: /^Ada Lovelace/ })) {
      expect(bar).toHaveAccessibleName(/in the way/);
    }
    expect(refresh).not.toHaveBeenCalled();
  });

  it("opens an owner block for editing", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    const user = renderView();
    await user.click(screen.getByRole("button", { name: /^Blocked: Painting/ }));

    const dialog = await screen.findByRole("dialog", { name: "Blocked dates" });
    const reason = within(dialog).getByLabelText("Reason");
    await user.clear(reason);
    await user.type(reason, "Painting the deck");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/blocks/paint",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          startDate: "2026-07-20",
          endDate: "2026-07-22",
          reason: "Painting the deck",
        }),
      }),
    );
  });

  it("shows a Google Calendar block read-only", async () => {
    const user = renderView();
    await user.click(
      screen.getByRole("button", { name: /^Blocked: Family.*from Google Calendar/ }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Blocked from Google Calendar" });
    expect(dialog).toHaveTextContent("read-only here");
    expect(within(dialog).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Delete block" })).not.toBeInTheDocument();
  });
});
