/**
 * The booking list's state lives in the URL, so a filtered view survives a
 * reload and can be bookmarked or shared. These helpers turn the page's
 * search params into a `listBookings` query and build links that change one
 * thing while keeping the rest. Client-safe.
 */
import type { z } from "zod";

import {
  BOOKING_SORTS,
  type BookingSort,
  listBookingsSchema,
  type ListBookingsQuery,
} from "./schema";

/** Which stays the list starts from: upcoming ones unless asked otherwise. */
export const WHEN = ["upcoming", "past", "all"] as const;
export type When = (typeof WHEN)[number];

type SearchParams = Record<string, string | string[] | undefined>;

/** The params the list understands, in the order they appear in its URLs. */
const KEYS = ["when", "propertyId", "status", "source", "from", "to", "q", "sort", "page"] as const;

/** The first value of each known param, dropping blanks (an empty form field). */
export function cleanParams(params: SearchParams): Partial<Record<(typeof KEYS)[number], string>> {
  const clean: Partial<Record<(typeof KEYS)[number], string>> = {};
  for (const key of KEYS) {
    const raw = params[key];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (value) clean[key] = value;
  }
  return clean;
}

export type ListState = {
  when: When;
  /** The params as given, for the filter form's initial values. */
  params: ReturnType<typeof cleanParams>;
};

/**
 * The query for `listBookings`, or the validation error to show. "Upcoming"
 * (the default) means stays still running or yet to start (check-out after
 * today), soonest first; "past" means stays that have started before today,
 * latest first. A from/to narrows either further; given without `when`, it
 * applies to all stays.
 */
export function parseListParams(
  params: SearchParams,
  /** Where the owner is: appToday() (GitLab #139). */
  today: string,
): ListState & ({ query: ListBookingsQuery } | { error: z.ZodError }) {
  const clean = cleanParams(params);
  // An explicit date range without a choice of stays means that range.
  const when: When = (WHEN as readonly string[]).includes(clean.when ?? "")
    ? (clean.when as When)
    : clean.from || clean.to
      ? "all"
      : "upcoming";

  const rest = { ...clean };
  delete rest.when;
  const window =
    when === "upcoming"
      ? { from: later(rest.from, today) }
      : when === "past"
        ? { to: earlier(rest.to, today) }
        : {};
  const parsed = listBookingsSchema.safeParse({
    ...rest,
    ...window,
    sort: rest.sort ?? (when === "past" ? "-checkIn" : "checkIn"),
  });
  return parsed.success
    ? { when, params: clean, query: parsed.data }
    : { when, params: clean, error: parsed.error };
}

/** The later of two calendar dates; `a` may be missing or malformed. */
function later(a: string | undefined, b: string): string {
  return a && /^\d{4}-\d{2}-\d{2}$/.test(a) && a > b ? a : b;
}

function earlier(a: string | undefined, b: string): string {
  return a && /^\d{4}-\d{2}-\d{2}$/.test(a) && a < b ? a : b;
}

/**
 * A link to the list with `changes` applied to the current params. Any
 * change other than the page goes back to page 1; `undefined` removes a param.
 */
export function listHref(
  current: ReturnType<typeof cleanParams>,
  changes: Partial<Record<(typeof KEYS)[number], string | undefined>>,
): string {
  const next: Record<string, string | undefined> = { ...current, ...changes };
  if (!("page" in changes)) delete next.page;
  const search = new URLSearchParams();
  for (const key of KEYS) {
    const value = next[key];
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `/bookings?${query}` : "/bookings";
}

/**
 * What clicking a column header sorts by: ascending first, descending when
 * already ascending on that column.
 */
export function nextSort(current: BookingSort, column: string): BookingSort {
  const ascending = column as BookingSort;
  const descending = `-${column}` as BookingSort;
  if (!BOOKING_SORTS.includes(ascending)) return current;
  return current === ascending ? descending : ascending;
}
