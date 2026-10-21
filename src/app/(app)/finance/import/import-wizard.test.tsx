// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImportWizard } from "./import-wizard";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const draft = (amountMinor: number, description: string) => ({
  date: "2026-07-14",
  type: "expense",
  amountMinor,
  currency: "EUR",
  category: "Cleaning",
  property: "Lake House",
  description,
});

const preview = {
  rows: [
    { line: 2, status: "ready", errors: [], duplicateOf: null, draft: draft(1250, "Soap") },
    {
      line: 3,
      status: "invalid",
      errors: [{ field: "amount", message: "must be an amount like 1234.50 or 1.234,50" }],
      duplicateOf: null,
      draft: null,
    },
    {
      line: 4,
      status: "duplicate",
      errors: [],
      duplicateOf: { line: 2 },
      draft: draft(1250, "Soap"),
    },
  ],
  summary: { ready: 1, duplicate: 1, invalid: 1, imported: 0, skipped: 0 },
};

describe("ImportWizard", () => {
  it("reads the file, guesses the columns, previews, and imports with confirmed duplicates", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init!.body));
      return Response.json(
        body.commit
          ? { ...preview, summary: { ready: 0, duplicate: 0, invalid: 1, imported: 2, skipped: 0 } }
          : preview,
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ImportWizard
        properties={[{ id: "p1", name: "Lake House" }]}
        categories={[{ id: "c1", name: "Cleaning", type: "expense" }]}
      />,
    );
    const user = userEvent.setup();
    const file = new File(
      [
        "Datum;Betrag;Verwendungszweck\n14.07.2026;-12,50;Soap\n15.07.2026;abc;x\n14.07.2026;-12,50;Soap\n",
      ],
      "bank.csv",
      { type: "text/csv" },
    );
    await user.upload(screen.getByLabelText("CSV file"), file);

    expect(await screen.findByText("3 rows read.")).toBeInTheDocument();
    expect(screen.getByLabelText("Date *")).toHaveDisplayValue(/^Datum/);
    expect(screen.getByLabelText("Amount *")).toHaveDisplayValue(/^Betrag/);
    expect(screen.getByLabelText("Description")).toHaveDisplayValue(/^Verwendungszweck/);

    await user.click(screen.getByRole("button", { name: "Check the rows" }));
    const sent = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(sent).toMatchObject({
      rows: [
        ["14.07.2026", "-12,50", "Soap"],
        ["15.07.2026", "abc", "x"],
        ["14.07.2026", "-12,50", "Soap"],
      ],
      firstLine: 2,
      mapping: { date: 0, amount: 1, description: 2 },
      defaults: { propertyId: "p1" },
      commit: false,
    });

    expect(await screen.findByText(/Amount must be an amount like 1234\.50/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 1 transaction" })).toBeEnabled();
    await user.click(screen.getByRole("checkbox", { name: /Line 4:.*same as line 2/ }));
    await user.click(screen.getByRole("button", { name: "Import 2 transactions" }));

    await waitFor(() => expect(screen.getByText("Imported")).toBeInTheDocument());
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toMatchObject({
      commit: true,
      include: [4],
    });
    expect(
      screen.getByText(/^2 imported, 0 skipped as duplicates, 1 left out with problems\.$/),
    ).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  // GitLab #129: each default is of its own type only.
  it("offers each default category of its own type only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => Response.json(preview)),
    );
    render(
      <ImportWizard
        properties={[{ id: "p1", name: "Lake House" }]}
        categories={[
          { id: "c1", name: "Cleaning", type: "expense" },
          { id: "c2", name: "Booking income", type: "income" },
        ]}
      />,
    );
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText("CSV file"),
      new File(["Datum;Betrag\n14.07.2026;-12,50\n"], "bank.csv", { type: "text/csv" }),
    );
    const names = (label: string) =>
      within(screen.getByLabelText(label))
        .getAllByRole("option")
        .map((option) => option.textContent);
    expect(await screen.findByLabelText("Category for expenses without one")).toBeInTheDocument();
    expect(names("Category for expenses without one")).toEqual(["None", "Cleaning"]);
    expect(names("Category for income without one")).toEqual(["None", "Booking income"]);
  });
});
