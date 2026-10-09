// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CalendarProperty } from "@/components/calendar/month-calendar";

import { CalendarView } from "./calendar-view";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));
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
  render(
    <CalendarView
      month="2026-07"
      weekStart={1}
      today="2026-07-08"
      calendars={[lake]}
      propertyChoice="all"
      userId="u1"
      properties={[]}
    />,
  );
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
  await user.click(screen.getByRole("button", { name: "Thursday, 23 July 2026" }));
  await user.click(screen.getByRole("button", { name: "Sunday, 26 July 2026" }));
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
    await user.click(
      within(screen.getByRole("region", { name: "July 2026" })).getByRole("button", {
        name: /^Blocked: Painting/,
      }),
    );

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
      within(screen.getByRole("region", { name: "July 2026" })).getByRole("button", {
        name: /^Blocked: Family.*from Google Calendar/,
      }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Blocked from Google Calendar" });
    expect(dialog).toHaveTextContent("read-only here");
    expect(within(dialog).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Delete block" })).not.toBeInTheDocument();
  });
});

describe("CalendarView property selector", () => {
  function renderWith(properties: { id: string; name: string }[]) {
    render(
      <CalendarView
        month="2026-07"
        weekStart={1}
        today="2026-07-08"
        calendars={[lake]}
        propertyChoice="all"
        userId="u1"
        properties={properties}
      />,
    );
    return userEvent.setup();
  }

  it("is hidden with a single property", () => {
    renderWith([]);
    expect(screen.queryByLabelText("Show")).not.toBeInTheDocument();
  });

  it("switches property through the URL and remembers it for this user", async () => {
    const user = renderWith([
      { id: "p1", name: "Lake House" },
      { id: "p2", name: "Sea View" },
    ]);
    await user.selectOptions(screen.getByLabelText("Show"), "p2");
    expect(push).toHaveBeenCalledWith("/calendar?month=2026-07&property=p2", { scroll: false });
    expect(document.cookie).toContain(`calendar-property=${encodeURIComponent("u1:p2")}`);
  });

  it("keeps the property when changing month", async () => {
    const user = renderWith([
      { id: "p1", name: "Lake House" },
      { id: "p2", name: "Sea View" },
    ]);
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(push).toHaveBeenCalledWith("/calendar?month=2026-08&property=all", { scroll: false });
  });
});

describe("CalendarView agenda (phones)", () => {
  function renderAgenda() {
    render(
      <CalendarView
        month="2026-07"
        weekStart={1}
        today="2026-07-08"
        calendars={[lake]}
        propertyChoice="all"
        userId="u1"
        properties={[]}
      />,
    );
    return userEvent.setup();
  }

  it("lists the month's stays and blocks, and opens a stay in a sheet", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        id: "ada",
        checkIn: "2026-07-10",
        checkOut: "2026-07-15",
        nights: 5,
        status: "confirmed",
        guestCount: 2,
        totalAmountMinor: 90000,
        currency: "EUR",
        guest: { name: "Ada Lovelace" },
        property: { name: "Lake House" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = renderAgenda();

    const agenda = screen.getByRole("region", { name: "Agenda" });
    expect(within(agenda).getByRole("heading", { name: "July 2026" })).toBeInTheDocument();
    const rows = within(agenda)
      .getAllByRole("button")
      .filter((b) => b.textContent !== "Show next month");
    expect(rows.map((r) => r.textContent?.split(/\d/)[0])).toEqual([
      "Ada Lovelace",
      "Blocked: Painting",
      "Blocked: Family",
    ]);

    await user.click(rows[0]!);
    const sheet = await screen.findByRole("dialog", { name: "Ada Lovelace" });
    expect(sheet).toHaveTextContent("€900.00");
    expect(within(sheet).getByRole("link", { name: "Open booking" })).toHaveAttribute(
      "href",
      "/bookings/ada",
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/bookings/ada", expect.anything());
  });

  it("opens a block from the agenda in its editor", async () => {
    const user = renderAgenda();
    const agenda = screen.getByRole("region", { name: "Agenda" });
    await user.click(within(agenda).getByRole("button", { name: /^Blocked: Painting/ }));
    expect(await screen.findByRole("dialog", { name: "Blocked dates" })).toBeInTheDocument();
  });

  it("loads the next month at the end of the list", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        properties: [
          {
            ...lake,
            bookings: [
              {
                id: "aug",
                checkIn: "2026-08-03",
                checkOut: "2026-08-06",
                status: "inquiry",
                source: "airbnb",
                guest: { id: "g9", name: "Grace Hopper" },
              },
            ],
            blocks: [],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = renderAgenda();
    await user.click(screen.getByRole("button", { name: "Show next month" }));

    const agenda = screen.getByRole("region", { name: "Agenda" });
    expect(await within(agenda).findByRole("heading", { name: "August 2026" })).toBeInTheDocument();
    expect(
      within(agenda).getByRole("button", { name: /^Grace Hopper.*inquiry/ }),
    ).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "/api/availability?propertyIds=p1&from=2026-08-01&to=2026-09-01",
    );
  });
});

describe("CalendarView double bookings", () => {
  it("names a platform's stay on a confirmed booking's dates and rings the booking", () => {
    render(
      <CalendarView
        month="2026-07"
        weekStart={1}
        today="2026-07-08"
        calendars={[lake]}
        propertyChoice="all"
        userId="u1"
        properties={[]}
        doubleBookings={[
          { id: "i1", feed: "Airbnb", start: "2026-07-12", end: "2026-07-16", bookingIds: ["ada"] },
        ]}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      /Airbnb has a stay 12\s–\s16 Jul 2026 on the dates of a confirmed booking/,
    );
    expect(
      within(alert).getByRole("link", { name: "Open the booking (Ada Lovelace)" }),
    ).toHaveAttribute("href", "/bookings/ada");
    for (const bar of screen.getAllByRole("link", { name: /^Ada Lovelace, Lake House/ })) {
      expect(bar).toHaveAccessibleName(/in the way/);
    }
  });
});
