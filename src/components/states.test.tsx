// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ErrorState } from "@/components/states";

describe("ErrorState", () => {
  it("is announced as an alert, with a default message", () => {
    render(<ErrorState />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("offers a retry only when given one", async () => {
    const { rerender } = render(<ErrorState />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    const onRetry = vi.fn();
    rerender(<ErrorState onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
