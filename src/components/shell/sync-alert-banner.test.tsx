// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SyncBadge } from "@/components/sync-badge";

import { SyncAlertBanner } from "./sync-alert-banner";

const google = vi.hoisted(() => ({
  available: true,
  status: "connected" as string,
  summary: { alert: true, failingSince: "2026-10-08T06:00:00.000Z" } as Record<string, unknown>,
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/google/connection", () => ({
  calendarConnectAvailable: () => google.available,
  getConnectionStatus: async () => ({ status: google.status }),
}));
vi.mock("@/lib/google/sync-summary", () => ({ syncSummary: async () => google.summary }));

async function renderBanner() {
  const banner = await SyncAlertBanner();
  render(<>{banner}</>);
}

describe("SyncAlertBanner", () => {
  it("shows when sync has been failing for over an hour, linking to the problems", async () => {
    await renderBanner();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Google Calendar sync has been failing since 8 Oct 2026, 06:00 (UTC).",
    );
    expect(screen.getByRole("link", { name: "Review sync problems" })).toHaveAttribute(
      "href",
      "/settings#google-sync",
    );
  });

  it("stays away otherwise", async () => {
    google.summary = { alert: false, failingSince: null };
    await renderBanner();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    google.summary = { alert: true, failingSince: null };
    google.status = "disconnected";
    await renderBanner();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("SyncBadge", () => {
  it("names each state in words, and shows nothing for a booking that is not synced", () => {
    const { rerender, container } = render(<SyncBadge state="failed" />);
    expect(container).toHaveTextContent("Sync failed, retrying");
    rerender(<SyncBadge state="dead" />);
    expect(container).toHaveTextContent("Sync stopped");
    rerender(<SyncBadge state="synced" />);
    expect(container).toHaveTextContent("In Google Calendar");
    rerender(<SyncBadge state="not_synced" />);
    expect(container).toBeEmptyDOMElement();
  });
});
