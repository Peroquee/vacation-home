// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toastError } from "@/components/toast";
import { Button } from "@/components/ui/button";

vi.mock("@/components/toast", () => ({ toastError: vi.fn() }));

function renderDialog(onConfirm: () => void | Promise<void>) {
  render(
    <ConfirmDialog
      trigger={<Button>Delete property</Button>}
      title="Delete this property?"
      description="Its bookings are kept."
      confirmLabel="Delete"
      destructive
      onConfirm={onConfirm}
    />,
  );
  return userEvent.setup();
}

describe("ConfirmDialog", () => {
  it("opens from its trigger and closes after a successful confirm", async () => {
    const onConfirm = vi.fn();
    const user = renderDialog(onConfirm);

    await user.click(screen.getByRole("button", { name: "Delete property" }));
    expect(screen.getByRole("alertdialog", { name: "Delete this property?" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("disables both buttons while the action is pending", async () => {
    let finish!: () => void;
    const user = renderDialog(() => new Promise<void>((resolve) => (finish = resolve)));

    await user.click(screen.getByRole("button", { name: "Delete property" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    finish();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("stays open and reports the error when the action fails", async () => {
    const failure = new Error("Property has bookings");
    const user = renderDialog(() => Promise.reject(failure));

    await user.click(screen.getByRole("button", { name: "Delete property" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(failure));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });
});

describe("ConfirmDialog without a trigger", () => {
  it("opens from code and reports closing", async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        open={false}
        onOpenChange={onOpenChange}
        title="Hide it?"
        onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    rerender(
      <ConfirmDialog open onOpenChange={onOpenChange} title="Hide it?" onConfirm={onConfirm} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConfirm).toHaveBeenCalled();
  });
});
