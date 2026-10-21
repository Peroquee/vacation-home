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

  // GitLab #129: "Type expense, and income categories can still be chosen."
  it("switched to expense, offers only expense categories and drops the income one", async () => {
    const fetchMock = serve();
    const { user } = renderDialog();
    const category = screen.getByLabelText("Category");
    const offered = () =>
      within(category)
        .getAllByRole("option")
        .map((option) => option.textContent);

    await user.click(screen.getByRole("radio", { name: "Income" }));
    await user.selectOptions(category, "c-other");
    await user.click(screen.getByRole("radio", { name: "Expense" }));
    expect(offered()).toEqual(["Choose…", "Cleaning", "Utilities"]);
    expect(category).toHaveValue("");
    // And back: the income category is not quietly restored.
    await user.click(screen.getByRole("radio", { name: "Income" }));
    expect(category).toHaveValue("");

    // Nothing of the other type is ever sent.
    await user.click(screen.getByRole("radio", { name: "Expense" }));
    await user.click(screen.getByLabelText("Amount"));
    await user.keyboard("5");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Category is required")).toBeInTheDocument();
    expect(saved(fetchMock)).toBeUndefined();
  });

  it("editing an income entry into an expense asks for an expense category", async () => {
    const fetchMock = serve(Response.json({}));
    const { user } = renderDialog({
      transaction: {
        id: "t2",
        propertyId: PROPERTY,
        type: "income",
        categoryId: "c-other",
        amountMinor: 5000,
        date: "2026-10-02",
        description: null,
        bookingId: null,
      },
    });
    const category = screen.getByLabelText("Category");
    expect(category).toHaveValue("c-other");
    await user.click(screen.getByRole("radio", { name: "Expense" }));
    expect(category).toHaveValue("");
    expect(within(category).queryByRole("option", { name: "Other income" })).toBeNull();
    await user.selectOptions(category, "c-util");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved(fetchMock)).toBeDefined());
    expect(saved(fetchMock)!.body).toMatchObject({ type: "expense", categoryId: "c-util" });
  });

  // GitLab #131: receipts straight away, uploaded once the entry is saved.
  describe("receipts on a new transaction", () => {
    const pdf = (name: string) => new File(["%PDF-1.7"], name, { type: "application/pdf" });
    /** Saves as t9; `refuse` names the uploads that fail, once each. */
    function serveUploads(refuse: string[] = []) {
      const refused = new Set(refuse);
      const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        if (url.startsWith("/api/bookings")) return Response.json({ items: [] });
        if (url === "/api/transactions/t9/attachments" && init?.method === "POST") {
          const name = ((init.body as FormData).get("file") as File).name;
          if (refused.delete(name)) {
            return Response.json(
              {
                error: {
                  code: "validation_failed",
                  message: "x",
                  fields: { file: ["is larger than 10 MB"] },
                },
              },
              { status: 422 },
            );
          }
          return Response.json({ id: `r-${name}` }, { status: 201 });
        }
        if (url === "/api/transactions" && init?.method === "POST") {
          return Response.json({ id: "t9" }, { status: 201 });
        }
        throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      const calls = (method: string, url: string) =>
        fetchMock.mock.calls.filter(([u, i]) => String(u) === url && i?.method === method);
      const uploaded = () =>
        calls("POST", "/api/transactions/t9/attachments").map(
          ([, init]) => ((init!.body as FormData).get("file") as File).name,
        );
      return { creates: () => calls("POST", "/api/transactions").length, uploaded };
    }

    it("creates the expense, then attaches both receipts", async () => {
      const server = serveUploads();
      const { user, onOpenChange } = renderDialog();
      await user.keyboard("19,99");
      await user.selectOptions(screen.getByLabelText("Category"), "c-clean");
      await user.upload(screen.getByLabelText("Add receipts", { selector: "input" }), [
        pdf("Rechnung.pdf"),
        pdf("Lieferschein.pdf"),
      ]);
      expect(screen.getByText("Rechnung.pdf")).toBeInTheDocument();
      expect(screen.getByText("Lieferschein.pdf")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Add" }));

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(server.creates()).toBe(1);
      expect(server.uploaded()).toEqual(["Rechnung.pdf", "Lieferschein.pdf"]);
      expect(toastSuccess).toHaveBeenCalledWith("Expense added");
    });

    it("a chosen file can be taken out again before saving", async () => {
      const server = serveUploads();
      const { user, onOpenChange } = renderDialog();
      await user.keyboard("5");
      await user.selectOptions(screen.getByLabelText("Category"), "c-clean");
      await user.upload(screen.getByLabelText("Add receipts", { selector: "input" }), [
        pdf("a.pdf"),
        pdf("b.pdf"),
      ]);
      await user.click(screen.getByRole("button", { name: "Don't add a.pdf" }));
      await user.click(screen.getByRole("button", { name: "Add" }));
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(server.uploaded()).toEqual(["b.pdf"]);
    });

    it("keeps the expense when an upload fails, says which, and retries only that one", async () => {
      const server = serveUploads(["Gross.pdf"]);
      const { user, onOpenChange } = renderDialog();
      await user.keyboard("80");
      await user.selectOptions(screen.getByLabelText("Category"), "c-util");
      await user.upload(screen.getByLabelText("Add receipts", { selector: "input" }), [
        pdf("Klein.pdf"),
        pdf("Gross.pdf"),
      ]);
      await user.click(screen.getByRole("button", { name: "Add" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The expense is saved, but not every receipt could be added.",
      );
      expect(screen.getByText("Gross.pdf: is larger than 10 MB")).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();
      // Saved and shown in the ledger already; the entry can't be sent twice.
      expect(refresh).toHaveBeenCalled();
      expect(screen.getByLabelText("Amount")).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Add" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(server.creates()).toBe(1);
      expect(server.uploaded()).toEqual(["Klein.pdf", "Gross.pdf", "Gross.pdf"]);
      expect(toastSuccess).toHaveBeenCalledWith("Expense added");
    });

    it("works for income too", async () => {
      const server = serveUploads();
      const { user, onOpenChange } = renderDialog();
      await user.click(screen.getByRole("radio", { name: "Income" }));
      await user.click(screen.getByLabelText("Amount"));
      await user.keyboard("300");
      await user.selectOptions(screen.getByLabelText("Category"), "c-other");
      await user.upload(
        screen.getByLabelText("Add receipts", { selector: "input" }),
        pdf("Auszahlung.pdf"),
      );
      await user.click(screen.getByRole("button", { name: "Add" }));
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(server.uploaded()).toEqual(["Auszahlung.pdf"]);
      expect(toastSuccess).toHaveBeenCalledWith("Income added");
    });

    it("sends nothing but the entry when no file was chosen", async () => {
      const server = serveUploads();
      const { user, onOpenChange } = renderDialog();
      await user.keyboard("5");
      await user.selectOptions(screen.getByLabelText("Category"), "c-clean");
      await user.click(screen.getByRole("button", { name: "Add" }));
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(server.uploaded()).toEqual([]);
    });
  });

  // GitLab #130: "Kommt diese Ausgabe regelmäßig? → Wiederkehrend machen".
  it("offers to make a new expense recurring, with what is typed so far", async () => {
    serve();
    const { user } = renderDialog();
    await user.keyboard("45");
    await user.selectOptions(screen.getByLabelText("Category"), "c-util");
    await user.type(screen.getByLabelText("Description"), "Internet");
    expect(screen.getByText("Does this expense come back regularly?")).toBeInTheDocument();
    const href = new URL(
      screen.getByRole("link", { name: "Make recurring" }).getAttribute("href")!,
      "http://x",
    );
    expect(href.pathname).toBe("/finance/recurring");
    expect(Object.fromEntries(href.searchParams)).toEqual({
      new: "1",
      propertyId: PROPERTY,
      date: "2026-10-08",
      categoryId: "c-util",
      amountMinor: "4500",
      description: "Internet",
    });

    // Not for income.
    await user.click(screen.getByRole("radio", { name: "Income" }));
    expect(screen.queryByRole("link", { name: "Make recurring" })).toBeNull();
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
