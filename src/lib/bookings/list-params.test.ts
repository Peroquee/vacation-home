import { describe, expect, it } from "vitest";

import { cleanParams, listHref, nextSort, parseListParams } from "./list-params";

const TODAY = "2026-10-08";
const PROPERTY = "6f1c2a52-6f0c-4c4e-9d43-3a0e4f1b9a11";

function query(params: Record<string, string | string[]>) {
  const state = parseListParams(params, TODAY);
  if ("error" in state) throw state.error;
  return state;
}

describe("cleanParams", () => {
  it("keeps the first value of known params and drops blanks", () => {
    expect(
      cleanParams({ q: " ada ", status: ["confirmed", "inquiry"], source: "", other: "x" }),
    ).toEqual({ q: "ada", status: "confirmed" });
  });
});

describe("parseListParams", () => {
  it("defaults to upcoming stays, soonest first", () => {
    const state = query({});
    expect(state.when).toBe("upcoming");
    expect(state.query).toMatchObject({ from: TODAY, sort: "checkIn", page: 1 });
    expect(state.query.to).toBeUndefined();
  });

  it("shows past stays latest first", () => {
    const state = query({ when: "past" });
    expect(state.query).toMatchObject({ to: TODAY, sort: "-checkIn" });
    expect(state.query.from).toBeUndefined();
  });

  it("narrows upcoming and past by an explicit range, never widening them", () => {
    expect(query({ when: "upcoming", from: "2026-12-01" }).query.from).toBe("2026-12-01");
    expect(query({ when: "upcoming", from: "2025-01-01" }).query.from).toBe(TODAY);
    expect(query({ when: "past", to: "2026-03-01" }).query.to).toBe("2026-03-01");
  });

  it("treats a date range without a choice as all stays", () => {
    const state = query({ from: "2025-03-01", to: "2025-04-01" });
    expect(state.when).toBe("all");
    expect(state.query).toMatchObject({ from: "2025-03-01", to: "2025-04-01" });
  });

  it("passes filters, search, sort and page through", () => {
    const state = query({
      when: "all",
      propertyId: PROPERTY,
      status: "confirmed",
      source: "booking.com",
      q: "ada",
      sort: "-total",
      page: "2",
    });
    expect(state.query).toMatchObject({
      propertyId: PROPERTY,
      status: ["confirmed"],
      source: ["booking.com"],
      q: "ada",
      sort: "-total",
      page: 2,
    });
  });

  it("ignores blank form fields", () => {
    expect(query({ propertyId: "", status: "", q: "" }).query.propertyId).toBeUndefined();
  });

  it("reports invalid params instead of guessing", () => {
    const state = parseListParams({ when: "all", propertyId: "nope", sort: "price" }, TODAY);
    expect("error" in state && state.error.issues.map((i) => i.path[0]).sort()).toEqual([
      "propertyId",
      "sort",
    ]);
  });
});

describe("listHref", () => {
  it("applies changes, drops empty values and resets the page", () => {
    const current = { when: "past", q: "ada", page: "3" } as const;
    expect(listHref(current, { status: "confirmed" })).toBe(
      "/bookings?when=past&status=confirmed&q=ada",
    );
    expect(listHref(current, { q: undefined, when: undefined })).toBe("/bookings");
  });

  it("keeps the rest when only the page changes", () => {
    expect(listHref({ q: "ada" }, { page: "2" })).toBe("/bookings?q=ada&page=2");
  });
});

describe("nextSort", () => {
  it("sorts ascending first, then flips", () => {
    expect(nextSort("checkIn", "total")).toBe("total");
    expect(nextSort("total", "total")).toBe("-total");
    expect(nextSort("-total", "total")).toBe("total");
  });

  it("ignores unknown columns", () => {
    expect(nextSort("checkIn", "price")).toBe("checkIn");
  });
});
