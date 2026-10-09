// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toastSuccess } from "@/components/toast";

import { LedgerView, type LedgerRow } from "./ledger-view";
import { TransactionDialog } from "./transaction-dialog";

const refresh = vi.fn();
const replace = vi.fn();
const search = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace, push: vi.fn() }),
  usePathname: () => "/finance",
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock("@/components/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

const PROPERTY = "6f1c2a52-6f0c-4c4e-9d43-3a0e4f1b9a11";
const properties = [{ id: PROPERTY, name: "Casa Azul", currency: "EUR" }];
const categories = [
  { id: "c-clean", name: "Cleaning", type: "expense" as const, color: "#0ea5e9" },
  { id: "c-util", name: "Utilities", type: "expense" as const, color: "#f59e0b" },
  { id: "c-other", name: "Other income", type: "income" as const, color: "#10b981" },
];
const defaults = { propertyId: PROPERTY, date: "2026-10-08" };

/** The dialog's own lookups: bookings to link, and an edited transaction's receipts. */
const lookup = (url: string) => url.startsWith("/api/bookings") || url.endsWith("/attachments");

/** Answers the lookups with nothing, and saves with `save`. */
function serve(save: Response = Response.json({}, { status: 201 })) {
  const fetchMock = vi.fn<typeof fetch>(async (input) =>
    String(input).startsWith("/api/bookings")
      ? Response.json({ items: [] })
      : String(input).endsWith("/attachments")
        ? Response.json([])
        : save,
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const saved = (fetchMock: ReturnType<typeof serve>) => {
  const call = fetchMock.mock.calls.find(([url]) => !lookup(String(url)));
  return (
    call && {
      url: String(call[0]),
      init: call[1]!,
      body: JSON.parse(String(call[1]!.body ?? "null")),
    }
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  search.value = "";
});

function renderDialog(props: Partial<React.ComponentProps<typeof TransactionDialog>> = {}) {
  const onOpenChange = vi.fn();
  render(
    <TransactionDialog
      open
      onOpenChange={onOpenChange}
      properties={properties}
      categories={categories}
      defaults={defaults}
      {...props}
    />,
  );
  return { user: userEvent.setup(), onOpenChange };
}

describe("TransactionDialog", () => {
  it("adds an expense with amount, category and Enter", async () => {
    const fetchMock = serve();
    const { user, onOpenChange } = renderDialog();

    // The amount has focus, so typing goes straight in.
    expect(screen.getByLabelText("Amount")).toHaveFocus();
    await user.keyboard("42,50");
    await user.selectOptions(screen.getByLabelText("Category"), "c-clean");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(saved(fetchMock)).toMatchObject({
      url: "/api/transactions",
      init: { method: "POST" },
      body: {
        propertyId: PROPERTY,
        type: "expense",
        categoryId: "c-clean",
        amountMinor: 4250,
        date: "2026-10-08",
        bookingId: null,
      },
    });
    expect(toastSuccess).toHaveBeenCalledWith("Expense added");
    expect(refresh).toHaveBeenCalled();
  });

  it("offers only the categories of the chosen type", async () => {
    serve();
    const { user } = renderDialog();
    const category = screen.getByLabelText("Category");
    expect(within(category).queryByRole("option", { name: "Other income" })).toBeNull();

    await user.selectOptions(category, "c-clean");
    await user.click(screen.getByRole("radio", { name: "Income" }));
    expect(screen.getByRole("radio", { name: "Income" })).toHaveAttribute("aria-checked", "true");
    expect(within(category).getByRole("option", { name: "Other income" })).toBeInTheDocument();
    // The expense category no longer fits, so the choice is cleared.
    expect(category).toHaveValue("");
  });

  it("says what is missing or malformed before sending", async () => {
    const fetchMock = serve();
    const { user } = renderDialog();
    await user.keyboard("1.000,50");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText(/Amount must be an amount like 1000.50/)).toBeInTheDocument();
    expect(screen.getByText("Category is required")).toBeInTheDocument();
    expect(saved(fetchMock)).toBeUndefined();
  });

  it("shows the API's per-field messages", async () => {
    serve(
      Response.json(
        {
          error: { code: "validation_failed", message: "x", fields: { categoryId: ["is hidden"] } },
        },
        { status: 422 },
      ),
    );
    const { user } = renderDialog();
    await user.keyboard("10");
    await user.selectOptions(screen.getByLabelText("Category"), "c-util");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Category is hidden")).toBeInTheDocument();
  });

  it("edits a transaction, keeping its property", async () => {
    const fetchMock = serve(Response.json({}));
    const { user } = renderDialog({
      transaction: {
        id: "t1",
        propertyId: PROPERTY,
        type: "expense",
        categoryId: "c-util",
        amountMinor: 12345,
        date: "2026-10-02",
        description: "Water",
        bookingId: null,
      },
    });
    expect(screen.getByLabelText("Amount")).toHaveValue("123.45");
    expect(screen.getByLabelText("Property")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const call = saved(fetchMock)!;
    expect(call.url).toBe("/api/transactions/t1");
    expect(call.init.method).toBe("PATCH");
    expect(call.body).not.toHaveProperty("propertyId");
    expect(call.body).toMatchObject({ amountMinor: 12345, description: "Water" });
  });
});

describe("LedgerView", () => {
  const rows: LedgerRow[] = [
    {
      id: "a",
      propertyId: PROPERTY,
      type: "income",
      categoryId: "c-other",
      amountMinor: 78000,
      date: "2026-10-01",
      description: "Booking Ada",
      bookingId: "b1",
      currency: "EUR",
      category: { id: "c-other", name: "Other income", color: "#10b981" },
      receipts: 2,
    },
    {
      id: "b",
      propertyId: PROPERTY,
      type: "expense",
      categoryId: "c-clean",
      amountMinor: 6000,
      date: "2026-10-03",
      description: null,
      bookingId: null,
      currency: "EUR",
      category: { id: "c-clean", name: "Cleaning", color: "#0ea5e9" },
      receipts: 0,
    },
  ];

  function renderLedger() {
    render(
      <LedgerView
        rows={rows}
        totals={[{ currency: "EUR", incomeMinor: 78000, expenseMinor: 6000, netMinor: 72000 }]}
        truncated={false}
        properties={properties}
        categories={categories}
        defaults={defaults}
      />,
    );
    return userEvent.setup();
  }

  it("shows the period's income, expenses and net, and a running net per row", () => {
    renderLedger();
    const totals = screen.getByText("Period totals (EUR)").closest("[data-slot=card]")!;
    expect(totals).toHaveTextContent(/Income€780\.00/);
    expect(totals).toHaveTextContent(/Expenses€60\.00/);
    expect(totals).toHaveTextContent(/Net€720\.00/);
    const table = screen.getByRole("table");
    expect(within(table).getByText("-€60.00")).toBeInTheDocument();
    // After the cleaning expense the period stands at €720.
    expect(within(table).getAllByText("€720.00")).toHaveLength(1);
    expect(within(table).getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      "/bookings/b1",
    );
  });

  it("opens quick-add through the URL, so the shortcut and the button agree", async () => {
    const user = renderLedger();
    await user.click(screen.getByRole("button", { name: /^Add/ }));
    expect(replace).toHaveBeenCalledWith("/finance?add=1", { scroll: false });
  });

  it("opens a row in the same form to edit it", async () => {
    serve();
    const user = renderLedger();
    await user.click(screen.getByRole("button", { name: /^Edit: Cleaning/ }));
    const dialog = await screen.findByRole("dialog", { name: "Edit transaction" });
    expect(within(dialog).getByLabelText("Amount")).toHaveValue("60.00");
  });

  it("starts open on ?add=1", () => {
    search.value = "month=2026-10&add=1";
    serve();
    renderLedger();
    expect(screen.getByRole("dialog", { name: "Add a transaction" })).toBeInTheDocument();
  });
});
