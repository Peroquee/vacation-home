import { describe, expect, it } from "vitest";

import {
  addMonths,
  gridRange,
  isMonthKey,
  layoutWeeks,
  monthWeeks,
  type Span,
  weekStartFor,
} from "./month";

const MONDAY = 1;
const SUNDAY = 0;

const span = (key: string, start: string, end: string): Span => ({ key, start, end });

/** The segments of `key` per week, as [fromLine, toLine, before, after, lane]. */
function placed(weeks: string[][], spans: Span[], key: string) {
  return layoutWeeks(weeks, spans).map((week) =>
    week
      .filter((s) => s.span.key === key)
      .map((s) => [s.fromLine, s.toLine, s.continuesBefore, s.continuesAfter, s.lane]),
  );
}

describe("months", () => {
  it("validates and steps month keys across years", () => {
    expect(isMonthKey("2026-07")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-7")).toBe(false);
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-07", -19)).toBe("2024-12");
  });

  it("starts the week where the locale does", () => {
    expect(weekStartFor("en-US")).toBe(SUNDAY);
    expect(weekStartFor("de-DE")).toBe(MONDAY);
    expect(weekStartFor("en-GB")).toBe(MONDAY);
  });
});

describe("monthWeeks", () => {
  it("fills whole weeks with the adjacent months' days", () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const weeks = monthWeeks("2026-10", MONDAY);
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(weeks[4]![6]).toBe("2026-11-01");
    expect(gridRange(weeks)).toEqual({ start: "2026-09-28", end: "2026-11-02" });
  });

  it("follows the week start", () => {
    // February 2026 runs Sunday the 1st to Saturday the 28th.
    expect(monthWeeks("2026-02", SUNDAY)).toHaveLength(4);
    expect(monthWeeks("2026-02", SUNDAY)[0]![0]).toBe("2026-02-01");
    const monday = monthWeeks("2026-02", MONDAY);
    expect(monday).toHaveLength(5);
    expect(monday[0]![0]).toBe("2026-01-26");
  });
});

describe("layoutWeeks", () => {
  // Monday 13 to Sunday 19 July 2026, and the week after.
  const july = monthWeeks("2026-07", MONDAY)
    .filter((w) => w[0] >= "2026-07-13")
    .slice(0, 2);

  it("draws a stay from mid check-in to mid check-out", () => {
    // In on Tuesday the 14th (afternoon half 3), out on Friday the 17th
    // (morning half 8): halves 3..8, grid lines 4 to 10.
    expect(placed(july, [span("a", "2026-07-14", "2026-07-17")], "a")).toEqual([
      [[4, 10, false, false, 0]],
      [],
    ]);
  });

  it("splits a stay across week rows", () => {
    // Saturday the 18th to Tuesday the 21st.
    expect(placed(july, [span("a", "2026-07-18", "2026-07-21")], "a")).toEqual([
      [[12, 15, false, true, 0]],
      [[1, 4, true, false, 0]],
    ]);
  });

  it("shows a check-out on the first morning of a week as a half", () => {
    // Out on Monday the 20th: only that morning in the second week.
    expect(placed(july, [span("a", "2026-07-16", "2026-07-20")], "a")).toEqual([
      [[8, 15, false, true, 0]],
      [[1, 2, true, false, 0]],
    ]);
  });

  it("keeps a same-day turnover as two shapes in one lane", () => {
    const spans = [span("out", "2026-07-11", "2026-07-15"), span("in", "2026-07-15", "2026-07-17")];
    expect(placed(july, spans, "out")[0]).toEqual([[1, 6, true, false, 0]]);
    expect(placed(july, spans, "in")[0]).toEqual([[6, 10, false, false, 0]]);
  });

  it("stacks overlapping spans in lanes, in the order given", () => {
    const spans = [
      span("stay", "2026-07-14", "2026-07-18"),
      span("inquiry", "2026-07-15", "2026-07-16"),
      span("later", "2026-07-18", "2026-07-19"),
    ];
    const [week] = layoutWeeks(july, spans);
    expect(week!.map((s) => [s.span.key, s.lane])).toEqual([
      ["stay", 0],
      ["inquiry", 1],
      // Starts the afternoon "stay" ends, so it fits back in lane 0.
      ["later", 0],
    ]);
  });

  it("renders a stay across a month boundary in both months", () => {
    const stay = span("a", "2026-10-30", "2026-11-03");
    const october = monthWeeks("2026-10", MONDAY);
    const november = monthWeeks("2026-11", MONDAY);
    expect(placed(october, [stay], "a").at(-1)).toEqual([[10, 15, false, true, 0]]);
    // November's grid starts with the same week, then the check-out week.
    expect(placed(november, [stay], "a").slice(0, 2)).toEqual([
      [[10, 15, false, true, 0]],
      [[1, 4, true, false, 0]],
    ]);
  });

  it("skips spans outside the grid", () => {
    expect(layoutWeeks(july, [span("a", "2026-06-01", "2026-06-05")]).flat()).toEqual([]);
  });

  it("lays out three busy months well within a frame", () => {
    const weeks = [
      ...monthWeeks("2026-06", MONDAY),
      ...monthWeeks("2026-07", MONDAY),
      ...monthWeeks("2026-08", MONDAY),
    ];
    const spans = Array.from({ length: 300 }, (_, i) => {
      const day = 1 + (i % 28);
      const month = ["06", "07", "08"][i % 3];
      return span(
        `s${i}`,
        `2026-${month}-${String(day).padStart(2, "0")}`,
        `2026-${month}-${String(Math.min(day + 3, 30)).padStart(2, "0")}`,
      );
    });
    const started = performance.now();
    layoutWeeks(weeks, spans);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
