/**
 * The dashboard's filter state, which lives in the URL so a reload or a
 * shared link shows the same view. Client-safe.
 *
 * The range is a preset (`?preset=last-12-months`), resolved against today,
 * or a custom `from` and `until`, both days included, as a person picks
 * them; the analytics API takes `[from, to)`, so `to` is the day after
 * `until`. Without either the dashboard shows the current month.
 */
import { addDays, type CalendarDate, isCalendarDate } from "@/lib/calendar-date";
import { addMonths } from "@/lib/calendar/month";

type SearchParams = Record<string, string | string[] | undefined>;

export const PRESETS = [
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "year-to-date", label: "Year to date" },
  { id: "last-12-months", label: "Last 12 months" },
] as const;
export type Preset = (typeof PRESETS)[number]["id"] | "custom";

export type DashboardState = {
  /** Which preset the range came from, or "custom". */
  preset: Preset;
  from: CalendarDate;
  /** The last day included. */
  until: CalendarDate;
  propertyId?: string;
  compare: "year" | "previous";
};

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

/** The current month, as the default range. */
export function thisMonth(today: CalendarDate): { from: CalendarDate; until: CalendarDate } {
  const month = today.slice(0, 7);
  return { from: `${month}-01`, until: addDays(`${addMonths(month, 1)}-01`, -1) };
}

/** The range a preset stands for, as of `today`. */
export function presetRange(
  preset: Exclude<Preset, "custom">,
  today: CalendarDate,
): { from: CalendarDate; until: CalendarDate } {
  const month = today.slice(0, 7);
  switch (preset) {
    case "this-month":
      return thisMonth(today);
    case "last-month":
      return thisMonth(`${addMonths(month, -1)}-01`);
    case "year-to-date":
      return { from: `${today.slice(0, 4)}-01-01`, until: today };
    case "last-12-months":
      // The twelve whole months up to and including this one.
      return { from: `${addMonths(month, -11)}-01`, until: thisMonth(today).until };
  }
}

/**
 * The state the URL asks for: a known preset, else a valid custom range,
 * else the current month.
 */
export function dashboardState(params: SearchParams, today: CalendarDate): DashboardState {
  const asked = first(params.preset);
  const from = first(params.from);
  const until = first(params.until);
  const preset = PRESETS.find((p) => p.id === asked)?.id;
  const custom =
    !preset && from && until && isCalendarDate(from) && isCalendarDate(until) && from <= until
      ? { from, until }
      : null;
  return {
    preset: preset ?? (custom ? "custom" : "this-month"),
    ...(preset ? presetRange(preset, today) : (custom ?? thisMonth(today))),
    propertyId: first(params.propertyId),
    compare: first(params.compare) === "previous" ? "previous" : "year",
  };
}

/**
 * The URL for a state: a preset by name (so a shared link keeps meaning
 * "last month"), a custom range by its dates, and the property.
 */
export function dashboardHref(state: Omit<DashboardState, "compare">): string {
  const params = new URLSearchParams(
    state.preset === "custom"
      ? { from: state.from, until: state.until }
      : state.preset === "this-month"
        ? {}
        : { preset: state.preset },
  );
  if (state.propertyId) params.set("propertyId", state.propertyId);
  const query = params.toString();
  return query ? `/dashboard?${query}` : "/dashboard";
}

/** The analytics API's query for a state. */
export function analyticsQuery(state: DashboardState) {
  return {
    from: state.from,
    to: addDays(state.until, 1),
    propertyId: state.propertyId,
    compare: state.compare,
  };
}
