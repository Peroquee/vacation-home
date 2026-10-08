/**
 * Date-range selection on the month calendar, as pure state transitions, so
 * mouse, touch and keyboard all go through the same rules and every case is
 * tested here. Client-safe.
 *
 * A selection runs from the day it was started on (the anchor) to the day
 * it reaches (the focus), in either direction: the earlier day is the
 * check-in, the later one the check-out. Selecting 14 to 17 July is three
 * nights, arriving the 14th and leaving the 17th.
 */
import { addDays, type CalendarDate, daysBetween } from "@/lib/calendar-date";

export type Selection =
  | { phase: "idle" }
  /** A drag is in progress: pointer held down since the anchor. */
  | { phase: "dragging"; anchor: CalendarDate; focus: CalendarDate }
  /** The start is set (a tap, a click or Enter); waiting for the end. */
  | { phase: "awaitingEnd"; anchor: CalendarDate; focus: CalendarDate };

export const IDLE: Selection = { phase: "idle" };

/** Check-in and check-out for an anchor and focus, ordered; null for one day. */
export function stayFrom(
  anchor: CalendarDate,
  focus: CalendarDate,
): { checkIn: CalendarDate; checkOut: CalendarDate } | null {
  if (anchor === focus) return null;
  return anchor < focus
    ? { checkIn: anchor, checkOut: focus }
    : { checkIn: focus, checkOut: anchor };
}

/** The days to highlight for a selection, first and last included. */
export function selectedDays(
  selection: Selection,
): { from: CalendarDate; to: CalendarDate } | null {
  if (selection.phase === "idle") return null;
  const { anchor, focus } = selection;
  return anchor <= focus ? { from: anchor, to: focus } : { from: focus, to: anchor };
}

export type Outcome =
  | { selection: Selection; done?: undefined }
  /** A finished range, for the caller to act on; the selection is reset. */
  | { selection: Selection; done: { checkIn: CalendarDate; checkOut: CalendarDate } };

/** Pointer pressed on `day`. */
export function press(selection: Selection, day: CalendarDate): Outcome {
  if (selection.phase === "awaitingEnd") return { selection: { ...selection, focus: day } };
  return { selection: { phase: "dragging", anchor: day, focus: day } };
}

/** Pointer moved over `day`: a drag follows it, a waiting start previews it. */
export function hover(selection: Selection, day: CalendarDate): Outcome {
  return selection.phase === "idle" ? { selection } : { selection: { ...selection, focus: day } };
}

/**
 * Pointer released on `day`. A drag over several days finishes there; a
 * press and release on one day sets the start and waits for the end, so two
 * taps read as start, then end. Ending on the start day itself cancels.
 */
export function release(selection: Selection, day: CalendarDate): Outcome {
  if (selection.phase === "idle") return { selection };
  const stay = stayFrom(selection.anchor, day);
  if (stay) return { selection: IDLE, done: stay };
  if (selection.phase === "dragging") {
    return { selection: { phase: "awaitingEnd", anchor: day, focus: day } };
  }
  return { selection: IDLE };
}

/** Escape, or anything else that abandons the selection. */
export function cancel(): Outcome {
  return { selection: IDLE };
}

export type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/** The day an arrow key moves to: a day sideways, a week up or down. */
export function step(day: CalendarDate, key: ArrowKey): CalendarDate {
  const days = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[key];
  return addDays(day, days);
}

/**
 * The keyboard: arrows move the focused day; with Shift they extend a
 * selection from where it started (starting one at the focused day if
 * none is running). Enter or Space sets the start, then the end.
 * Returns the outcome and the day that should have focus next.
 */
export function key(
  selection: Selection,
  focused: CalendarDate,
  pressed: { key: string; shiftKey: boolean },
): (Outcome & { focusDay: CalendarDate }) | null {
  if (pressed.key === "Escape") return { ...cancel(), focusDay: focused };
  if (pressed.key === "Enter" || pressed.key === " ") {
    if (selection.phase === "idle") {
      return {
        selection: { phase: "awaitingEnd", anchor: focused, focus: focused },
        focusDay: focused,
      };
    }
    return { ...release({ ...selection, phase: "awaitingEnd" }, focused), focusDay: focused };
  }
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(pressed.key)) return null;

  const next = step(focused, pressed.key as ArrowKey);
  if (pressed.shiftKey) {
    const anchor = selection.phase === "idle" ? focused : selection.anchor;
    return { selection: { phase: "awaitingEnd", anchor, focus: next }, focusDay: next };
  }
  // A plain arrow moves the end of a running selection along with focus.
  return { ...hover(selection, next), focusDay: next };
}

/** Nights in a finished or previewed stay. */
export function nightsOf(stay: { checkIn: CalendarDate; checkOut: CalendarDate }): number {
  return daysBetween(stay.checkIn, stay.checkOut);
}
