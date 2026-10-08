// @vitest-environment jsdom
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuickAddShortcut } from "./quick-add-shortcut";

const push = vi.fn();
const location = vi.hoisted(() => ({ pathname: "/calendar", search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(location.search),
}));

afterEach(() => {
  vi.clearAllMocks();
  location.pathname = "/calendar";
  location.search = "";
});

describe("QuickAddShortcut", () => {
  it("opens quick-add on T from any page", async () => {
    render(<QuickAddShortcut />);
    await userEvent.setup().keyboard("t");
    expect(push).toHaveBeenCalledWith("/finance?add=1", { scroll: false });
  });

  it("keeps the ledger's filters when already there", async () => {
    location.pathname = "/finance";
    location.search = "month=2026-07&type=expense";
    render(<QuickAddShortcut />);
    await userEvent.setup().keyboard("T");
    expect(push).toHaveBeenCalledWith("/finance?month=2026-07&type=expense&add=1", {
      scroll: false,
    });
  });

  it("stays out of the way while typing or with a modifier", async () => {
    render(
      <>
        <QuickAddShortcut />
        <input aria-label="Notes" />
      </>,
    );
    const user = userEvent.setup();
    await user.click(document.querySelector("input")!);
    await user.keyboard("t");
    await user.keyboard("{Control>}t{/Control}");
    expect(push).not.toHaveBeenCalled();
  });
});
