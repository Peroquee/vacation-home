// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Rule } from "./recurring-view";
import { RuleDialog } from "./rule-dialog";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const properties = [
  { id: "p1", name: "Lake House", currency: "EUR", archived: false },
  { id: "p2", name: "Old Flat", currency: "EUR", archived: true },
];
const categories = [
  { id: "c-mortgage", name: "Mortgage" },
  { id: "c-utilities", name: "Utilities" },
];
const rule: Rule = {
  id: "r1",
  propertyId: "p1",
  category: { id: "c-mortgage", name: "Mortgage", color: "#2a78d6" },
  amountMinor: 95_000,
  currency: "EUR",
  interval: "monthly",
  startDate: "2026-01-01",
  endDate: null,
  description: "Sparkasse loan",
  documents: 0,
  status: "active",
  nextDueDate: "2026-11-01",
  pausedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** Saves with `response`; an edited rule's documents and payments (GitLab #130) are none. */
function serve(response: Response = Response.json({}, { status: 201 })) {
  const fetchMock = vi.fn<typeof fetch>(async (url, init) =>
    init?.method
      ? response
      : String(url).endsWith("/payments")
        ? Response.json({ items: [], total: 0 })
        : Response.json([]),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const saves = (fetchMock: ReturnType<typeof serve>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method);
const sent = (fetchMock: ReturnType<typeof serve>) => {
  const [url, init] = saves(fetchMock)[0]!;
  return [url, init?.method, JSON.parse(String(init?.body))];
};

describe("RuleDialog", () => {
  it("starts a new rule on today as the server says, not the UTC date (GitLab #139)", () => {
    // 00:30 on 15 July in Berlin is still the 14th in UTC.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-14T22:30:00Z"));
    try {
      serve();
      render(
        <RuleDialog
          today="2026-07-15"
          prefill={null}
          properties={properties}
          categories={categories}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByLabelText("First due")).toHaveValue("2026-07-15");
    } finally {
      vi.useRealTimers();
    }
  });

  it("adds a rule with every field", async () => {
    const fetchMock = serve();
    const onClose = vi.fn();
    render(
      <RuleDialog
        today="2026-10-26"
        prefill={null}
        properties={properties}
        categories={categories}
        onClose={onClose}
      />,
    );
    // Archived properties get no new rules; the only active one is chosen.
    expect(screen.getByLabelText("Property")).toHaveValue("p1");
    expect(screen.queryByRole("option", { name: "Old Flat" })).toBeNull();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Category"), "c-utilities");
    await user.type(screen.getByLabelText("Amount"), "180");
    await user.selectOptions(screen.getByLabelText("Every"), "quarterly");
    await user.clear(screen.getByLabelText("First due"));
    await user.type(screen.getByLabelText("First due"), "2026-11-15");
    await user.type(screen.getByLabelText("Last due (optional)"), "2028-12-31");
    await user.type(screen.getByLabelText("Description"), "Stadtwerke prepayment");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
    expect(sent(fetchMock)).toEqual([
      "/api/recurring-expenses",
      "POST",
      {
        propertyId: "p1",
        categoryId: "c-utilities",
        amountMinor: 18_000,
        interval: "quarterly",
        startDate: "2026-11-15",
        endDate: "2028-12-31",
        description: "Stadtwerke prepayment",
      },
    ]);
  });

  it("checks the amount and category before sending", async () => {
    const fetchMock = serve();
    render(
      <RuleDialog
        today="2026-10-26"
        prefill={null}
        properties={properties}
        categories={categories}
        onClose={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Amount"), "12,3,4");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Category is required")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount")).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("edits only what applies from now on", async () => {
    const fetchMock = serve(Response.json({}));
    const onClose = vi.fn();
    render(
      <RuleDialog
        today="2026-10-26"
        rule={rule}
        prefill={null}
        properties={properties}
        categories={categories}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Edit recurring cost" })).toBeInTheDocument();
    expect(screen.getByLabelText("Property")).toBeDisabled();
    expect(screen.getByLabelText("Every")).toBeDisabled();
    expect(screen.getByLabelText("First due")).toBeDisabled();
    const amount = screen.getByLabelText("Amount");
    expect(amount).toHaveValue("950.00");

    const user = userEvent.setup();
    await user.clear(amount);
    await user.type(amount, "980");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent(fetchMock)).toEqual([
      "/api/recurring-expenses/r1",
      "PATCH",
      {
        categoryId: "c-mortgage",
        amountMinor: 98_000,
        endDate: null,
        description: "Sparkasse loan",
      },
    ]);
  });

  it("shows the API's 422 next to the field", async () => {
    serve(
      Response.json(
        {
          error: {
            code: "validation_failed",
            message: "The request has invalid fields.",
            fields: { endDate: ["must not be before the start date"] },
          },
        },
        { status: 422 },
      ),
    );
    const onClose = vi.fn();
    render(
      <RuleDialog
        today="2026-10-26"
        rule={rule}
        prefill={null}
        properties={properties}
        categories={categories}
        onClose={onClose}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Last due (optional)"), "2025-12-01");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const endDate = screen.getByLabelText("Last due (optional)");
    await waitFor(() => expect(endDate).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText(/^Last due \(optional\) /)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  // GitLab #129: a rule is an expense; "make recurring" never brings another category along.
  it("takes a prefill's category only if it is one of the expense categories offered", () => {
    const prefill = (categoryId: string) => ({
      propertyId: "p1",
      categoryId,
      amountMinor: 4_200,
      startDate: "2026-11-02",
      description: "Water",
    });
    const { unmount } = render(
      <RuleDialog
        today="2026-10-26"
        prefill={prefill("c-utilities")}
        properties={properties}
        categories={categories}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Category")).toHaveValue("c-utilities");
    unmount();

    render(
      <RuleDialog
        today="2026-10-26"
        prefill={prefill("c-booking-income")}
        properties={properties}
        categories={categories}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Category")).toHaveValue("");
    expect(screen.queryByRole("option", { name: /income/i })).toBeNull();
  });
});
