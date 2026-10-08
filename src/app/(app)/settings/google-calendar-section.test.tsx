// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toastSuccess } from "@/components/toast";

import { GoogleCalendarSection, type PropertySync } from "./google-calendar-section";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const lake: PropertySync = { property: { id: "p1", name: "Lake House" }, calendar: null };
const connected = {
  status: "connected" as const,
  googleEmail: "owner@example.com",
  connectedAt: "2026-10-01T09:00:00.000Z",
};
const calendars = [
  { id: "primary@example.com", summary: "Owner", primary: true },
  { id: "rentals@group", summary: "Rentals", primary: false },
];

/** Answers the calendar list, then each further request in turn. */
function serve(...answers: Response[]) {
  const fetchMock = vi.fn<typeof fetch>(async (input) =>
    String(input) === "/api/google/calendars"
      ? Response.json(calendars)
      : (answers.shift() ?? new Response(null, { status: 204 })),
  );
  vi.stubGlobal("fetch", fetchMock);
  return () =>
    fetchMock.mock.calls
      .filter(([url]) => String(url) !== "/api/google/calendars")
      .map(([url, init]) => [
        init?.method,
        String(url),
        init?.body && JSON.parse(String(init.body)),
      ]);
}

describe("GoogleCalendarSection", () => {
  it("offers to connect, and no property settings, when not connected", () => {
    render(<GoogleCalendarSection connection={{ status: "not_connected" }} properties={[lake]} />);
    expect(screen.getByRole("link", { name: "Connect Google Calendar" })).toHaveAttribute(
      "href",
      "/api/google/connect",
    );
    expect(screen.queryByLabelText("Calendar")).not.toBeInTheDocument();
  });

  it("explains a revoked connection and offers to reconnect", () => {
    render(
      <GoogleCalendarSection
        connection={{ status: "disconnected", reason: "revoked" }}
        properties={[lake]}
      />,
    );
    expect(screen.getByText(/no longer allows this app/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect" })).toBeInTheDocument();
  });

  it("reports how the trip to Google ended", () => {
    render(
      <GoogleCalendarSection
        connection={{ status: "not_connected" }}
        properties={[]}
        returned="scope_missing"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/calendar permission was not granted/);
  });

  it("shows the sync summary when the API reports one", () => {
    serve();
    render(
      <GoogleCalendarSection
        connection={{
          ...connected,
          sync: {
            lastSyncedAt: "2026-10-08T07:30:00.000Z",
            pending: 2,
            failed: 1,
            lastError: "Calendar not found",
          },
        }}
        properties={[lake]}
      />,
    );
    expect(
      screen.getByText(/Last synced Oct 8, 2026, 7:30 AM \(UTC\) · 2 waiting/),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 failed: Calendar not found/)).toBeInTheDocument();
  });

  it("says plainly that disconnecting leaves Google events alone", async () => {
    const calls = serve(new Response(null, { status: 204 }));
    const user = userEvent.setup();
    render(<GoogleCalendarSection connection={connected} properties={[lake]} />);
    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("All syncing stops, for every property.");
    expect(dialog).toHaveTextContent("Events already in your Google calendars are left untouched");
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()).toEqual([["DELETE", "/api/google/connection", undefined]]);
  });

  it("starts syncing a property to a chosen calendar", async () => {
    const calls = serve(Response.json({ calendar: {} }));
    const user = userEvent.setup();
    render(<GoogleCalendarSection connection={connected} properties={[lake]} />);

    const select = screen.getByLabelText("Calendar");
    await waitFor(() =>
      expect(within(select).getByRole("option", { name: "Rentals" })).toBeInTheDocument(),
    );
    await user.selectOptions(select, "rentals@group");
    await user.click(screen.getByRole("checkbox", { name: "Block dates for other events there" }));
    await user.click(screen.getByRole("button", { name: "Start syncing" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()).toEqual([
      [
        "PUT",
        "/api/properties/p1/calendar",
        { calendarId: "rentals@group", outbound: true, inbound: true },
      ],
    ]);
  });

  it("resyncs and stops syncing a synced property", async () => {
    const calls = serve(
      Response.json({ scheduled: 4 }, { status: 202 }),
      new Response(null, { status: 204 }),
    );
    const user = userEvent.setup();
    render(
      <GoogleCalendarSection
        connection={connected}
        properties={[
          {
            ...lake,
            calendar: {
              calendarId: "rentals@group",
              calendarName: "Rentals",
              outbound: true,
              inbound: false,
            },
          },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Resync everything" }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Resync started", "4 bookings queued."),
    );

    await user.click(screen.getByRole("button", { name: "Stop syncing" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Events already in the calendar are left untouched.");
    await user.click(within(dialog).getByRole("button", { name: "Stop syncing" }));

    await waitFor(() => expect(calls()).toHaveLength(2));
    expect(calls()).toEqual([
      ["POST", "/api/properties/p1/calendar/resync", undefined],
      ["DELETE", "/api/properties/p1/calendar", undefined],
    ]);
  });
});
