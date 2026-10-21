// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toastError, toastSuccess } from "@/components/toast";

import { ReceiptsSection } from "../receipts-section";
import type { Rule } from "./recurring-view";
import { RuleDialog } from "./rule-dialog";
import { RulePayments } from "./rule-payments";

// GitLab #130: documents on a recurring cost, and receipts on its payments.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const pdf = (name: string) => new File(["%PDF-1.7"], name, { type: "application/pdf" });
const payments = {
  items: [
    { id: "t2", date: "2026-01-01", amountMinor: 48_000, currency: "EUR", receipts: 0 },
    { id: "t1", date: "2025-01-01", amountMinor: 48_000, currency: "EUR", receipts: 2 },
  ],
  total: 2,
};

/** Answers by URL; POSTs are recorded and answered 201. */
function serve(routes: Record<string, unknown>) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") return Response.json({ id: "new" }, { status: 201 });
    if (url in routes) return Response.json(routes[url]);
    throw new Error(`unexpected GET ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const posted = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([url, init]) => [String(url), ((init!.body as FormData).get("file") as File).name]);
  return { fetchMock, posted };
}

describe("a rule's documents", () => {
  it("are listed, and uploaded to the rule", async () => {
    const { posted } = serve({
      "/api/recurring-expenses/r1/attachments": [
        {
          id: "a1",
          transactionId: null,
          recurringExpenseId: "r1",
          fileName: "Police.pdf",
          mediaType: "application/pdf",
          size: 1000,
          hasThumbnail: false,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    render(<ReceiptsSection recurringExpenseId="r1" />);
    const section = screen.getByRole("region", { name: "Documents" });
    expect(await within(section).findByRole("link", { name: "Open Police.pdf" })).toHaveAttribute(
      "href",
      "/api/attachments/a1",
    );
    expect(section).toHaveTextContent("20 per recurring cost");

    await userEvent
      .setup()
      .upload(within(section).getByLabelText("Add documents", { selector: "input" }), [
        pdf("Vertrag.pdf"),
      ]);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(posted()).toEqual([["/api/recurring-expenses/r1/attachments", "Vertrag.pdf"]]);
  });

  it("say so when there are none", async () => {
    serve({ "/api/recurring-expenses/r1/attachments": [] });
    render(<ReceiptsSection recurringExpenseId="r1" />);
    expect(await screen.findByText(/^No documents yet/)).toBeInTheDocument();
  });
});

describe("a rule's payments", () => {
  it("show which have receipts, and add one to the payment chosen", async () => {
    const { posted } = serve({ "/api/recurring-expenses/r1/payments": payments });
    render(<RulePayments ruleId="r1" />);
    const section = screen.getByRole("region", { name: "Payments" });
    const rows = await within(section).findAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("1 Jan 2026€480.00no receipt");
    expect(rows[1]).toHaveTextContent("2 receipts");
    expect(within(rows[0]!).getByRole("link", { name: "1 Jan 2026" })).toHaveAttribute(
      "href",
      "/finance?month=2026-01",
    );

    const user = userEvent.setup();
    await user.click(
      within(rows[0]!).getByRole("button", { name: "Add a receipt to the payment of 1 Jan 2026" }),
    );
    await user.upload(within(section).getByLabelText("Receipt for a payment"), pdf("2026.pdf"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(posted()).toEqual([["/api/transactions/t2/attachments", "2026.pdf"]]);
    expect(toastSuccess).toHaveBeenCalledWith("Receipt added to the payment of 1 Jan 2026");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("say how many more the ledger holds", async () => {
    serve({ "/api/recurring-expenses/r1/payments": { ...payments, total: 30 } });
    render(<RulePayments ruleId="r1" />);
    expect(
      await screen.findByText("The latest 2 of 30; the others are in the ledger."),
    ).toBeInTheDocument();
  });
});

describe("RuleDialog", () => {
  const rule: Rule = {
    id: "r1",
    propertyId: "p1",
    category: { id: "c1", name: "Insurance", color: "#2a78d6" },
    amountMinor: 48_000,
    currency: "EUR",
    interval: "annual",
    startDate: "2025-01-01",
    endDate: null,
    description: "Building insurance",
    documents: 0,
    status: "active",
    nextDueDate: "2027-01-01",
    pausedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
  const props = {
    prefill: null,
    properties: [{ id: "p1", name: "Lake House", currency: "EUR", archived: false }],
    categories: [{ id: "c1", name: "Insurance" }],
    onClose: () => {},
  };

  it("holds the documents and the payments of a saved rule", async () => {
    serve({
      "/api/recurring-expenses/r1/attachments": [],
      "/api/recurring-expenses/r1/payments": payments,
    });
    render(<RuleDialog rule={rule} {...props} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("region", { name: "Documents" })).toBeInTheDocument();
    expect(
      await within(within(dialog).getByRole("region", { name: "Payments" })).findAllByRole(
        "listitem",
      ),
    ).toHaveLength(2);
  });

  it("asks a new rule to be saved first", () => {
    serve({});
    render(<RuleDialog {...props} />);
    expect(screen.queryByRole("region", { name: "Documents" })).toBeNull();
    expect(screen.getByText(/can be added once the recurring cost is saved/)).toBeInTheDocument();
  });
});
