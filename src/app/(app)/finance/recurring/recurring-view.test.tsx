// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type Rule, RecurringView } from "./recurring-view";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const properties = [{ id: "p1", name: "Lake House", currency: "EUR", archived: false }];
const categories = [
  { id: "c-mortgage", name: "Mortgage" },
  { id: "c-utilities", name: "Utilities" },
];
const rule = (over: Partial<Rule> = {}): Rule => ({
  id: "r1",
  propertyId: "p1",
  category: { id: "c-mortgage", name: "Mortgage", color: "#2a78d6" },
  amountMinor: 95_000,
  currency: "EUR",
  interval: "monthly",
  startDate: "2026-01-01",
  endDate: null,
  description: "Sparkasse loan",
  status: "active",
  nextDueDate: "2026-11-01",
  pausedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

function serve() {
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json({}));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("RecurringView", () => {
  it("lists each rule with property, amount per interval, next due date and status", () => {
    render(
      <RecurringView
        rules={[
          rule(),
          rule({
            id: "r2",
            category: { id: "c-utilities", name: "Utilities", color: "#eb6834" },
            description: null,
            amountMinor: 18_000,
            interval: "quarterly",
            status: "paused",
            nextDueDate: "2027-01-01",
          }),
          rule({
            id: "r3",
            interval: "annual",
            status: "ended",
            nextDueDate: null,
            description: "Old insurance",
          }),
        ]}
        properties={properties}
        categories={categories}
        prefill={null}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent(
      /Sparkasse loan.*Mortgage.*Lake House.*€950\.00 a month.*1 Nov 2026.*Active/,
    );
    expect(rows[1]).toHaveTextContent(/Utilities.*€180\.00 a quarter.*When resumed.*Paused/);
    expect(rows[2]).toHaveTextContent(/Old insurance.*a year.*–.*Ended/);
    // An ended rule cannot be paused or resumed.
    expect(within(rows[2]!).queryByRole("button", { name: /^(Pause|Resume)/ })).toBeNull();
    // The ledger's badge links to this anchor.
    expect(document.getElementById("rule-r1")).not.toBeNull();
  });

  it("pauses an active rule and resumes a paused one", async () => {
    const fetchMock = serve();
    render(
      <RecurringView
        rules={[rule(), rule({ id: "r2", status: "paused", description: "Water" })]}
        properties={properties}
        categories={categories}
        prefill={null}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Pause Sparkasse loan" }));
    await user.click(screen.getByRole("button", { name: "Resume Water" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.map(([url, init]) => [init?.method, url])).toEqual([
      ["POST", "/api/recurring-expenses/r1/pause"],
      ["POST", "/api/recurring-expenses/r2/resume"],
    ]);
  });

  it("deletes after asking, and says the ledger keeps its entries", async () => {
    const fetchMock = serve();
    render(
      <RecurringView
        rules={[rule()]}
        properties={properties}
        categories={categories}
        prefill={null}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete Sparkasse loan" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Those already in the ledger stay as they are.");
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]).toEqual(["/api/recurring-expenses/r1", { method: "DELETE" }]);
  });

  it("offers to add the first one, and opens straight away from a ledger transaction", () => {
    const { unmount } = render(
      <RecurringView rules={[]} properties={properties} categories={categories} prefill={null} />,
    );
    expect(screen.getByText("No recurring costs yet")).toBeInTheDocument();
    unmount();

    render(
      <RecurringView
        rules={[]}
        properties={properties}
        categories={categories}
        prefill={{
          propertyId: "p1",
          categoryId: "c-utilities",
          amountMinor: 18_000,
          startDate: "2026-11-14",
          description: "Stadtwerke",
        }}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Add a recurring cost" });
    expect(within(dialog).getByLabelText("Amount")).toHaveValue("180.00");
    expect(within(dialog).getByLabelText("Category")).toHaveValue("c-utilities");
    expect(within(dialog).getByLabelText("First due")).toHaveValue("2026-11-14");
    expect(within(dialog).getByLabelText("Description")).toHaveValue("Stadtwerke");
  });
});
