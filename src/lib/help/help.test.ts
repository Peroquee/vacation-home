import { describe, expect, it } from "vitest";

import { appRoutes } from "../../../e2e/app-routes";

import { checkBlocks, resolveBlocks, splitFrontMatter } from "./blocks";
import { HELP_ROUTES, helpKeyFor, isHelpKey, NO_HELP_ROUTES } from "./routes";

describe("which help a page gets", () => {
  it("covers exactly the owner pages", () => {
    const pages = appRoutes()
      .filter((r) => r.kind === "page" && r.file.startsWith("src/app/(app)/"))
      .map((r) => r.route)
      .filter((route) => !(NO_HELP_ROUTES as readonly string[]).includes(route));
    expect([...HELP_ROUTES].sort()).toEqual(pages.sort());
  });

  it("maps a path to its page's key, a fixed segment before an id", () => {
    expect(helpKeyFor("/calendar")).toBe("calendar");
    expect(helpKeyFor("/bookings/requests")).toBe("bookings-requests");
    expect(helpKeyFor("/bookings/new")).toBe("bookings-new");
    expect(helpKeyFor("/bookings/3c7d6f0e-1b2a-4c5d-8e9f-0a1b2c3d4e5f")).toBe("bookings-[id]");
    expect(helpKeyFor("/bookings/3c7d6f0e/edit")).toBe("bookings-[id]-edit");
    expect(helpKeyFor("/settings/properties/x/pricing")).toBe("settings-properties-[id]-pricing");
    expect(helpKeyFor("/nowhere")).toBeNull();
  });

  it("knows its keys, so no path reaches the file system", () => {
    expect(isHelpKey("bookings-[id]")).toBe(true);
    expect(isHelpKey("../../.env")).toBe(false);
  });
});

describe("conditional help", () => {
  const text = [
    "1. Accept.",
    "   :::if-email",
    "   The guest gets an email.",
    "   :::",
    "   :::if-no-email",
    "   Tell the guest yourself.",
    "   :::",
    "Done.",
  ].join("\n");

  it("keeps what is true now, and drops the markers", () => {
    expect(resolveBlocks(text, { email: true })).toBe(
      ["1. Accept.", "   The guest gets an email.", "Done."].join("\n"),
    );
    expect(resolveBlocks(text, { email: false })).toBe(
      ["1. Accept.", "   Tell the guest yourself.", "Done."].join("\n"),
    );
  });

  it("finds blocks left open, nested or closed twice, and unknown ones", () => {
    expect(checkBlocks(text)).toEqual([]);
    expect(checkBlocks(":::if-email\nx")).toEqual(["line 1: the block is never closed"]);
    expect(checkBlocks(":::if-email\n:::if-no-email\n:::")).toHaveLength(1);
    expect(checkBlocks(":::")).toEqual(['line 1: ":::" closes no block']);
    expect(checkBlocks(":::if-smtp\n:::")).toHaveLength(2);
  });

  it("reads the guide section from the front matter", () => {
    expect(splitFrontMatter("---\nguide: bookings\n---\n\n# Title\n")).toEqual({
      guide: "bookings",
      body: "\n# Title\n",
    });
    expect(splitFrontMatter("# No front matter")).toEqual({
      guide: null,
      body: "# No front matter",
    });
  });
});
