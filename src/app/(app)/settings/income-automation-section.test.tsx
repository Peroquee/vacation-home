// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toastSuccess } from "@/components/toast";

import { IncomeAutomationSection, type PropertyIncomeSettings } from "./income-automation-section";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const lake = (settings: PropertyIncomeSettings["settings"]): PropertyIncomeSettings => ({
  property: { id: "p1", name: "Lake House" },
  settings,
});

/** Answers the PUT with `answer`; returns the requests made. */
function serve(answer: unknown) {
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json(answer));
  vi.stubGlobal("fetch", fetchMock);
  return () =>
    fetchMock.mock.calls.map(([url, init]) => [
      init?.method,
      String(url),
      JSON.parse(String(init?.body)),
    ]);
}

describe("IncomeAutomationSection (GitLab #137)", () => {
  it("says per property whether bookings enter the ledger by themselves", () => {
    render(
      <IncomeAutomationSection
        properties={[
          lake({ enabled: true, onCancel: "zero" }),
          {
            property: { id: "p2", name: "Sea View" },
            settings: { enabled: false, onCancel: "delete" },
          },
        ]}
      />,
    );
    expect(screen.getByText("On · cancelled: entries kept at 0")).toBeInTheDocument();
    expect(
      screen.getByText(/^Off: bookings enter the ledger only with their payments$/),
    ).toBeInTheDocument();
  });

  it("switches it on, saying first that bookings so far are added, then how many were", async () => {
    const user = userEvent.setup();
    const requests = serve({ enabled: true, onCancel: "delete", added: 6, removed: 0 });
    render(<IncomeAutomationSection properties={[lake({ enabled: false, onCancel: "delete" })]} />);

    await user.click(screen.getByRole("button", { name: "Edit the booking income of Lake House" }));
    expect(screen.getByLabelText("When a booking is cancelled")).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", {
        name: "Enter bookings in the ledger as income automatically",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(/Bookings confirmed so far are added too/);
    await user.selectOptions(screen.getByLabelText("When a booking is cancelled"), "zero");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(requests()).toEqual([
      ["PUT", "/api/properties/p1/income-automation", { enabled: true, onCancel: "zero" }],
    ]);
    expect(toastSuccess).toHaveBeenCalledWith(
      "Booking income switched on: 6 entries added to the ledger",
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("switches it off, saying the automatic entries go and edited ones stay", async () => {
    const user = userEvent.setup();
    serve({ enabled: false, onCancel: "delete", added: 0, removed: 1 });
    render(<IncomeAutomationSection properties={[lake({ enabled: true, onCancel: "delete" })]} />);

    await user.click(screen.getByRole("button", { name: "Edit the booking income of Lake House" }));
    await user.click(
      screen.getByRole("checkbox", {
        name: "Enter bookings in the ledger as income automatically",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(/those you edited stay/);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(toastSuccess).toHaveBeenCalledWith(
      "Booking income switched off: 1 entry taken out of the ledger",
    );
  });
});
