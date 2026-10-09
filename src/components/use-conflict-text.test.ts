// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useConflictText } from "./use-conflict-text";

const booked = { kind: "booking", id: "b1", start: "2026-07-14", end: "2026-07-18" } as const;

function text() {
  return renderHook(() => useConflictText()).result.current;
}

describe("useConflictText", () => {
  it("names the guest when known", () => {
    const { describe } = text();
    expect(describe(booked, new Map([["b1", "Ada Lovelace"]]))).toMatch(
      /^Booked by Ada Lovelace, 14\s–\s18 Jul 2026$/,
    );
    expect(describe(booked)).toMatch(/^Booked, 14\s–\s18 Jul 2026$/);
  });

  it("gives a block's reason, or its origin", () => {
    const { describe } = text();
    const block = { kind: "block", id: "k1", start: "2026-07-20", end: "2026-07-21" } as const;
    expect(describe({ ...block, reason: "Painting", origin: "manual" })).toMatch(
      /^Blocked \(Painting\), /,
    );
    expect(describe({ ...block, reason: null, origin: "google" })).toMatch(
      /^Blocked \(Google Calendar\), /,
    );
  });

  it("explains a changeover fix with the long date", () => {
    const { fix } = text();
    expect(fix({ move: "checkIn", to: "2026-07-15" })).toMatch(/^Arrive on 15 July 2026 instead/);
    expect(fix({ move: "checkOut", to: "2026-07-10" })).toMatch(/^Leave on 10 July 2026 instead/);
  });
});
