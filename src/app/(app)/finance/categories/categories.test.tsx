// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toastSuccess } from "@/components/toast";

import {
  CategoryFormDialog,
  type CategoryRow,
  DeleteCategory,
  HideToggle,
} from "./category-dialogs";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const pool: CategoryRow = {
  id: "pool",
  name: "Pool care",
  type: "expense",
  color: "#0ea5e9",
  isSystem: false,
  hidden: false,
};
const garden: CategoryRow = { ...pool, id: "garden", name: "Garden" };
const supplies: CategoryRow = { ...pool, id: "supplies", name: "Supplies" };

type Answer = { status: number; body?: unknown };

/** Answers requests in order and records them. */
function serve(...answers: Answer[]) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    const { status, body } = answers.shift() ?? { status: 200, body: {} };
    return status === 204 ? new Response(null, { status }) : Response.json(body, { status });
  });
  vi.stubGlobal("fetch", fetchMock);
  const calls = () =>
    fetchMock.mock.calls.map(([url, init]) => [
      init?.method ?? "GET",
      String(url),
      init?.body ? JSON.parse(String(init.body)) : undefined,
    ]);
  return calls;
}

const inUse: Answer = {
  status: 409,
  body: { error: { code: "conflict", message: "in use", reason: "in_use" } },
};

describe("DeleteCategory", () => {
  it("deletes an unused category after asking", async () => {
    const calls = serve({ status: 204 });
    const user = userEvent.setup();
    render(<DeleteCategory category={pool} targets={[garden]} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()).toEqual([["DELETE", "/api/categories/pool", undefined]]);
  });

  it("offers to move the transactions of a category in use, then deletes it", async () => {
    const calls = serve(inUse, { status: 200, body: { moved: 3 } }, { status: 204 });
    const user = userEvent.setup();
    render(<DeleteCategory category={pool} targets={[garden, supplies]} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );

    const offer = await screen.findByRole("alertdialog", { name: "Pool care is in use" });
    await user.selectOptions(within(offer).getByLabelText("Move transactions to"), "supplies");
    await user.click(within(offer).getByRole("button", { name: "Move and delete" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()).toEqual([
      ["DELETE", "/api/categories/pool", undefined],
      ["POST", "/api/categories/pool/reassign", { to: "supplies" }],
      ["DELETE", "/api/categories/pool", undefined],
    ]);
    expect(toastSuccess).toHaveBeenCalledWith(
      "Pool care deleted",
      "3 transactions moved to Supplies.",
    );
  });

  it("offers to hide a category in use that has nowhere to move to", async () => {
    const calls = serve(inUse, { status: 200, body: {} });
    const user = userEvent.setup();
    render(<DeleteCategory category={pool} targets={[]} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    await user.click(await screen.findByRole("button", { name: "Hide instead" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()[1]).toEqual(["PATCH", "/api/categories/pool", { hidden: true }]);
  });

  it("offers to hide a default category the server refuses to delete", async () => {
    const calls = serve(
      { status: 409, body: { error: { code: "conflict", message: "system", reason: "system" } } },
      { status: 200, body: {} },
    );
    const user = userEvent.setup();
    render(<DeleteCategory category={pool} targets={[garden]} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    const offer = await screen.findByRole("alertdialog", {
      name: "Pool care is a default category",
    });
    await user.click(within(offer).getByRole("button", { name: "Hide instead" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()[1]).toEqual(["PATCH", "/api/categories/pool", { hidden: true }]);
  });
});

describe("HideToggle", () => {
  it("hides a visible category and shows a hidden one", async () => {
    const calls = serve({ status: 200, body: {} }, { status: 200, body: {} });
    const user = userEvent.setup();
    const { rerender } = render(<HideToggle category={pool} />);
    await user.click(screen.getByRole("button", { name: "Hide" }));
    rerender(<HideToggle category={{ ...pool, hidden: true }} />);
    await user.click(screen.getByRole("button", { name: "Show" }));

    await waitFor(() => expect(calls()).toHaveLength(2));
    expect(calls().map(([, , body]) => body)).toEqual([{ hidden: true }, { hidden: false }]);
  });
});

describe("CategoryFormDialog", () => {
  it("adds a category with a type and colour", async () => {
    const calls = serve({ status: 201, body: {} });
    const user = userEvent.setup();
    render(<CategoryFormDialog trigger={<button>Add category</button>} />);
    await user.click(screen.getByRole("button", { name: "Add category" }));
    await user.type(screen.getByLabelText("Name"), "Pool care");
    await user.selectOptions(screen.getByLabelText("Type"), "income");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Add category" }),
    );

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()).toEqual([
      ["POST", "/api/categories", { name: "Pool care", type: "income", color: "#64748b" }],
    ]);
  });

  it("edits the name and colour but never the type", async () => {
    const calls = serve({
      status: 409,
      body: {
        error: { code: "conflict", message: "taken", fields: { name: ["is already taken"] } },
      },
    });
    const user = userEvent.setup();
    render(<CategoryFormDialog category={pool} trigger={<button>Edit</button>} />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Type")).toBeDisabled();
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Garden");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Name is already taken")).toBeInTheDocument();
    expect(calls()).toEqual([
      ["PATCH", "/api/categories/pool", { name: "Garden", color: "#0ea5e9" }],
    ]);
  });
});
