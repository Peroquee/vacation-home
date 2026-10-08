import { describe, expect, it } from "vitest";

import {
  cancel,
  hover,
  IDLE,
  key,
  nightsOf,
  press,
  release,
  type Selection,
  selectedDays,
  stayFrom,
} from "./selection";

/** Runs pointer events in order and returns the last outcome. */
function pointer(events: [kind: "press" | "hover" | "release", day: string][]) {
  let selection: Selection = IDLE;
  let done;
  for (const [kind, day] of events) {
    const outcome = { press, hover, release }[kind](selection, day);
    selection = outcome.selection;
    done = outcome.done ?? done;
  }
  return { selection, done };
}

describe("stayFrom", () => {
  it("orders the two ends, whichever came first", () => {
    expect(stayFrom("2026-07-14", "2026-07-17")).toEqual({
      checkIn: "2026-07-14",
      checkOut: "2026-07-17",
    });
    expect(stayFrom("2026-07-17", "2026-07-14")).toEqual({
      checkIn: "2026-07-14",
      checkOut: "2026-07-17",
    });
    expect(stayFrom("2026-07-14", "2026-07-14")).toBeNull();
    expect(nightsOf(stayFrom("2026-07-14", "2026-07-17")!)).toBe(3);
  });
});

describe("pointer", () => {
  it("selects by dragging", () => {
    const { done, selection } = pointer([
      ["press", "2026-07-14"],
      ["hover", "2026-07-15"],
      ["hover", "2026-07-17"],
      ["release", "2026-07-17"],
    ]);
    expect(done).toEqual({ checkIn: "2026-07-14", checkOut: "2026-07-17" });
    expect(selection).toEqual(IDLE);
  });

  it("orders a drag backwards across the start", () => {
    const { done } = pointer([
      ["press", "2026-07-17"],
      ["hover", "2026-07-18"],
      ["hover", "2026-07-12"],
      ["release", "2026-07-12"],
    ]);
    expect(done).toEqual({ checkIn: "2026-07-12", checkOut: "2026-07-17" });
  });

  it("selects by two taps, previewing in between", () => {
    const afterFirst = pointer([
      ["press", "2026-07-14"],
      ["release", "2026-07-14"],
      ["hover", "2026-07-16"],
    ]);
    expect(afterFirst.done).toBeUndefined();
    expect(selectedDays(afterFirst.selection)).toEqual({ from: "2026-07-14", to: "2026-07-16" });

    const { done } = pointer([
      ["press", "2026-07-14"],
      ["release", "2026-07-14"],
      ["press", "2026-07-11"],
      ["release", "2026-07-11"],
    ]);
    expect(done).toEqual({ checkIn: "2026-07-11", checkOut: "2026-07-14" });
  });

  it("cancels when the second tap lands on the start", () => {
    expect(
      pointer([
        ["press", "2026-07-14"],
        ["release", "2026-07-14"],
        ["press", "2026-07-14"],
        ["release", "2026-07-14"],
      ]),
    ).toEqual({ selection: IDLE, done: undefined });
  });

  it("ignores hovering with nothing started, and cancels on Escape", () => {
    expect(hover(IDLE, "2026-07-14").selection).toEqual(IDLE);
    expect(cancel().selection).toEqual(IDLE);
  });
});

describe("keyboard", () => {
  const down = (k: string, shiftKey = false) => ({ key: k, shiftKey });

  it("moves by day and by week", () => {
    expect(key(IDLE, "2026-07-14", down("ArrowRight"))?.focusDay).toBe("2026-07-15");
    expect(key(IDLE, "2026-07-14", down("ArrowUp"))?.focusDay).toBe("2026-07-07");
    expect(key(IDLE, "2026-07-31", down("ArrowDown"))?.focusDay).toBe("2026-08-07");
    expect(key(IDLE, "2026-07-14", down("ArrowRight"))?.selection).toEqual(IDLE);
  });

  it("extends a selection with shift and the arrows, then finishes with Enter", () => {
    let state: Selection = IDLE;
    let focused = "2026-07-14";
    for (const k of ["ArrowRight", "ArrowRight", "ArrowRight"]) {
      const outcome = key(state, focused, down(k, true))!;
      state = outcome.selection;
      focused = outcome.focusDay;
    }
    expect(selectedDays(state)).toEqual({ from: "2026-07-14", to: "2026-07-17" });
    expect(key(state, focused, down("Enter"))?.done).toEqual({
      checkIn: "2026-07-14",
      checkOut: "2026-07-17",
    });
  });

  it("starts with Enter and ends with Enter on another day", () => {
    const started = key(IDLE, "2026-07-14", down("Enter"))!;
    expect(started.selection).toMatchObject({ phase: "awaitingEnd", anchor: "2026-07-14" });
    const moved = key(started.selection, "2026-07-14", down("ArrowLeft"))!;
    expect(key(moved.selection, moved.focusDay, down(" "))?.done).toEqual({
      checkIn: "2026-07-13",
      checkOut: "2026-07-14",
    });
  });

  it("cancels with Escape and ignores other keys", () => {
    const started = key(IDLE, "2026-07-14", down("Enter"))!;
    expect(key(started.selection, "2026-07-14", down("Escape"))?.selection).toEqual(IDLE);
    expect(key(IDLE, "2026-07-14", down("a"))).toBeNull();
  });
});
