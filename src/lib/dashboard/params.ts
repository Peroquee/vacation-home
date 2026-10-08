/**
 * The dashboard's filter state, which lives in the URL so a reload or a
 * shared link shows the same view. Client-safe.
 *
 * The range is `from` and `until`, both days included, as a person picks
 * them; the analytics API takes `[from, to)`, so `to` is the day after
 * `until`. Without a range the dashboard shows the current month.
 */
import { addDays, type CalendarDate, isCalendarDate } from "@/lib/calendar-date";
import { addMonths } from "@/lib/calendar/month";

type SearchParams = Record<string, string | string[] | undefined>;

export type DashboardState = {
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

/** The state the URL asks for, falling back to the current month for a missing or broken range. */
export function dashboardState(params: SearchParams, today: CalendarDate): DashboardState {
  const from = first(params.from);
  const until = first(params.until);
  const range =
    from && until && isCalendarDate(from) && isCalendarDate(until) && from <= until
      ? { from, until }
      : thisMonth(today);
  return {
    ...range,
    propertyId: first(params.propertyId),
    compare: first(params.compare) === "previous" ? "previous" : "year",
  };
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
