/**
 * Dragging a booking's bar on the calendar (GitLab #66): what stay a drag
 * makes. Pure and client-safe, so the rules are tested on their own.
 *
 * - **move**: the body of the bar shifts the whole stay by the days the
 *   pointer moved;
 * - **start** / **end**: the bar's edges move check-in or check-out.
 *
 * A drag only counts once the pointer has travelled `DRAG_THRESHOLD_PX` and
 * the stay actually changes by a whole day, so a click, a jitter or a
 * one-pixel slip never moves a booking.
 */
import { addDays, type CalendarDate, daysBetween } from "@/lib/calendar-date";

export type DragMode = "move" | "start" | "end";
export type Stay = { checkIn: CalendarDate; checkOut: CalendarDate };

/** How far the pointer must travel before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 6;

export function pastThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}

/**
 * The stay after dragging from `originDay` to `day`; null when it would not
 * be a stay (check-out on or before check-in) or nothing changed.
 */
export function draggedStay(
  stay: Stay,
  mode: DragMode,
  originDay: CalendarDate,
  day: CalendarDate,
): Stay | null {
  const shift = daysBetween(originDay, day);
  if (shift === 0) return null;
  const next =
    mode === "move"
      ? { checkIn: addDays(stay.checkIn, shift), checkOut: addDays(stay.checkOut, shift) }
      : mode === "start"
        ? { checkIn: addDays(stay.checkIn, shift), checkOut: stay.checkOut }
        : { checkIn: stay.checkIn, checkOut: addDays(stay.checkOut, shift) };
  if (next.checkOut <= next.checkIn) return null;
  return next.checkIn === stay.checkIn && next.checkOut === stay.checkOut ? null : next;
}
