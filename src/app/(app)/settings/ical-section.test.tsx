// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FeedDto } from "@/lib/ical/feeds";

import { type IcalProperty, IcalSection } from "./ical-section";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const feed = (over: Partial<FeedDto> = {}): FeedDto => ({
  id: "f1",
  propertyId: "p1",
  name: "Airbnb",
  host: "www.airbnb.com",
  lastFetchedAt: "2026-10-09T09:00:00.000Z",
  lastSuccessAt: "2026-10-09T09:00:00.000Z",
  lastError: null,
  eventCount: 3,
  conflictCount: 0,
  nextFetchAt: "2026-10-09T09:30:00.000Z",
  ...over,
});
const lake = (over: Partial<IcalProperty> = {}): IcalProperty => ({
  id: "p1",
  name: "Lake House",
  feeds: [],
  exportUrl: null,
  ...over,
});

/** Records the requests and answers each in turn. */
function serve(...answers: Response[]) {
  const fetchMock = vi.fn<typeof fetch>(
    async () => answers.shift() ?? new Response(null, { status: 204 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return () =>
    fetchMock.mock.calls.map(([url, init]) => [
      init?.method,
      String(url),
      init?.body && JSON.parse(String(init.body)),
    ]);
}

describe("IcalSection", () => {
  it("lists a feed by name and host, never its link, with what the last read found", () => {
    render(<IcalSection properties={[lake({ feeds: [feed()] })]} />);
    expect(screen.getByText("Airbnb")).toBeInTheDocument();
    expect(screen.getByText(/www\.airbnb\.com/)).toBeInTheDocument();
    expect(screen.getByText(/^3 stays · last read 9 Oct 2026, 09:00 \(UTC\)$/)).toBeInTheDocument();
  });

  it("says in words why a read failed, and flags double bookings", () => {
    render(
      <IcalSection
        properties={[
          lake({
            feeds: [
              feed({ id: "a", lastError: "http_404" }),
              feed({ id: "b", name: "Booking.com", lastError: "not_ical" }),
              feed({ id: "c", name: "Vrbo", conflictCount: 1 }),
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText(/^The platform answered 404/)).toBeInTheDocument();
    expect(screen.getByText(/^The link does not lead to an iCal calendar/)).toBeInTheDocument();
    expect(
      screen.getByText(/^1 stay clashes with a confirmed booking: a double booking/),
    ).toBeInTheDocument();
  });

  it("adds a feed and reads it at once", async () => {
    const calls = serve(Response.json(feed(), { status: 201 }));
    render(<IcalSection properties={[lake()]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add a calendar" }));
    await user.type(screen.getByLabelText("Name"), "Airbnb");
    await user.type(screen.getByLabelText("Calendar export link"), "https://www.airbnb.com/x.ics");
    await user.click(screen.getByRole("button", { name: "Add and read" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()).toEqual([
      [
        "POST",
        "/api/properties/p1/ical-feeds",
        { name: "Airbnb", url: "https://www.airbnb.com/x.ics" },
      ],
    ]);
  });

  it("shows the API's field messages", async () => {
    serve(
      Response.json(
        {
          error: {
            code: "validation_failed",
            message: "x",
            fields: { url: ["must be an http(s) link to the platform's calendar export"] },
          },
        },
        { status: 422 },
      ),
    );
    render(<IcalSection properties={[lake()]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add a calendar" }));
    await user.type(screen.getByLabelText("Name"), "X");
    await user.click(screen.getByRole("button", { name: "Add and read" }));
    expect(
      await screen.findByText(
        "Calendar export link must be an http(s) link to the platform's calendar export",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the export off until switched on", async () => {
    const calls = serve(Response.json({ enabled: true, url: "https://x/api/ical/t.ics" }));
    render(<IcalSection properties={[lake()]} />);
    const box = screen.getByRole("checkbox", { name: /Publish this property's taken dates/ });
    expect(box).not.toBeChecked();
    expect(screen.queryByRole("textbox", { name: "Calendar link" })).not.toBeInTheDocument();
    await userEvent.setup().click(box);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()).toEqual([["POST", "/api/properties/p1/ical-export", {}]]);
  });

  it("shows the link once on, and makes a new one after asking", async () => {
    const calls = serve(Response.json({ enabled: true, url: "https://x/api/ical/new.ics" }));
    render(<IcalSection properties={[lake({ exportUrl: "https://x/api/ical/old.ics" })]} />);
    expect(screen.getByRole("textbox", { name: "Calendar link" })).toHaveValue(
      "https://x/api/ical/old.ics",
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Make a new link" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/stops working at once/);
    await user.click(within(dialog).getByRole("button", { name: "Make a new link" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()).toEqual([["POST", "/api/properties/p1/ical-export", { rotate: true }]]);
  });

  it("switches the export off", async () => {
    const calls = serve(Response.json({ enabled: false, url: null }));
    render(<IcalSection properties={[lake({ exportUrl: "https://x/api/ical/old.ics" })]} />);
    await userEvent.setup().click(screen.getByRole("checkbox", { name: /Publish/ }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()).toEqual([["DELETE", "/api/properties/p1/ical-export", undefined]]);
  });
});
