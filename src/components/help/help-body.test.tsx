// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HelpBody } from "./help-body";

afterEach(() => vi.unstubAllGlobals());

describe("HelpBody", () => {
  it("links to the guide's section, and lets the panel close on the way", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ markdown: "## Calendar\n\nDrag across the days.", guide: "the-calendar" }),
      ),
    );
    const onLeave = vi.fn();
    render(<HelpBody helpKey="calendar" onLeave={onLeave} />);
    const more = await screen.findByRole("link", { name: "More in the user guide" });
    expect(more).toHaveAttribute("href", "/help#the-calendar");
    // jsdom does not navigate; the click is what matters here.
    more.addEventListener("click", (event) => event.preventDefault());
    await userEvent.setup().click(more);
    expect(onLeave).toHaveBeenCalledOnce();
  });
});
