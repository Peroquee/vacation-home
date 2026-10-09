/**
 * The occupancy chart and heatmap, as pure functions. Client-safe.
 *
 * Occupancy is booked nights divided by available nights, per month, as the
 * analytics service counts them: only confirmed bookings occupy a night,
 * and with blocks excluded (the default) a night the owner blocked and no
 * guest booked is not available either.
 */
import { addDays, type CalendarDate } from "@/lib/calendar-date";
import { addMonths, type MonthKey } from "@/lib/calendar/month";

type MonthNights = { month: MonthKey; bookedNights: number; availableNights: number };

/** Booked / available per month, 0-1; null for a month with no available nights. */
export function monthlyOccupancy(
  months: MonthNights[],
): { month: MonthKey; rate: number | null; booked: number; available: number }[] {
  return months.map((m) => ({
    month: m.month,
    rate: m.availableNights === 0 ? null : m.bookedNights / m.availableNights,
    booked: m.bookedNights,
    available: m.availableNights,
  }));
}

/**
 * The current months beside the same months a year earlier, matched by
 * position (the prior report covers the same dates shifted by a year).
 */
export function withPriorYear(
  current: ReturnType<typeof monthlyOccupancy>,
  prior: ReturnType<typeof monthlyOccupancy> | null,
) {
  return current.map((m, i) => ({ ...m, priorRate: prior?.[i]?.rate ?? null }));
}

/** The twelve months ending with the month of `until`: `[start, end)`. */
export function heatmapWindow(until: CalendarDate): { start: CalendarDate; end: CalendarDate } {
  const last = until.slice(0, 7);
  return { start: `${addMonths(last, -11)}-01`, end: `${addMonths(last, 1)}-01` };
}

export type HeatmapMonth = {
  month: MonthKey;
  /** One entry per day of the month: how many properties were booked that night. */
  days: { date: CalendarDate; booked: number }[];
};

/**
 * Booked properties per night, by month, from each property's night-by-night
 * availability ("booked" means a confirmed stay that night).
 */
export function heatmap(
  window: { start: CalendarDate; end: CalendarDate },
  properties: { days: { date: CalendarDate; status: string }[] }[],
): HeatmapMonth[] {
  const booked = new Map<CalendarDate, number>();
  for (const property of properties) {
    for (const day of property.days) {
      if (day.status === "booked") booked.set(day.date, (booked.get(day.date) ?? 0) + 1);
    }
  }
  const months: HeatmapMonth[] = [];
  for (let date = window.start; date < window.end; date = addDays(date, 1)) {
    const month = date.slice(0, 7);
    if (months.at(-1)?.month !== month) months.push({ month, days: [] });
    months.at(-1)!.days.push({ date, booked: booked.get(date) ?? 0 });
  }
  return months;
}

/**
 * The step of the sequential ramp for a count out of `max`: 0 is empty, then
 * evenly up to the darkest step. With one property a booked night is simply
 * the darkest step.
 */
export function heatStep(booked: number, max: number, steps: number): number {
  if (booked <= 0 || max <= 0) return 0;
  return Math.max(1, Math.round((booked / max) * steps));
}
