/**
 * The ledger page's state and arithmetic, as pure functions. Client-safe.
 *
 * The ledger shows one period (a month by default) as a statement: oldest
 * first, each row with the running net up to it. Amounts stay integers of
 * minor units throughout.
 */
import { addDays, type CalendarDate, isCalendarDate } from "@/lib/calendar-date";
import { addMonths, isMonthKey, type MonthKey } from "@/lib/calendar/month";

type SearchParams = Record<string, string | string[] | undefined>;

const KEYS = ["month", "from", "until", "propertyId", "type", "categoryId"] as const;
export type LedgerParams = Partial<Record<(typeof KEYS)[number], string>>;

/** The first value of each known param, blanks dropped. */
export function ledgerParams(params: SearchParams): LedgerParams {
  const clean: LedgerParams = {};
  for (const key of KEYS) {
    const raw = params[key];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (value) clean[key] = value;
  }
  return clean;
}

/** The month a period covers, as `[from, to)` dates: to is the next month's first. */
export function monthRange(month: MonthKey): { from: CalendarDate; to: CalendarDate } {
  return { from: `${month}-01`, to: `${addMonths(month, 1)}-01` };
}

/** The month to show: the one asked for, or the one containing today. */
export function ledgerMonth(params: LedgerParams, today: CalendarDate): MonthKey {
  return params.month && isMonthKey(params.month) ? params.month : today.slice(0, 7);
}

/**
 * The period the ledger shows, as `[from, to)`: a custom range
 * (`?from=&until=`, both days included, e.g. from the dashboard) when both
 * ends are valid dates in order, otherwise the month.
 */
export function ledgerPeriod(
  params: LedgerParams,
  today: CalendarDate,
): { from: CalendarDate; to: CalendarDate; month: MonthKey | null } {
  const { from, until } = params;
  if (from && until && isCalendarDate(from) && isCalendarDate(until) && from <= until) {
    return { from, to: addDays(until, 1), month: null };
  }
  const month = ledgerMonth(params, today);
  return { ...monthRange(month), month };
}

/** A link to the ledger with `changes` applied; undefined removes a param. */
export function ledgerHref(current: LedgerParams, changes: LedgerParams): string {
  const next: Record<string, string | undefined> = { ...current, ...changes };
  const search = new URLSearchParams();
  for (const key of KEYS) if (next[key]) search.set(key, next[key]!);
  const query = search.toString();
  return query ? `/finance?${query}` : "/finance";
}

type Row = { id: string; type: "income" | "expense"; amountMinor: number; currency: string };

/** +amount for income, -amount for an expense. */
export function signedMinor(row: Pick<Row, "type" | "amountMinor">): number {
  return row.type === "income" ? row.amountMinor : -row.amountMinor;
}

/**
 * The running net after each row, per currency, for rows in statement order
 * (oldest first). Each currency runs on its own: minor units of different
 * currencies cannot be added up.
 */
export function runningNet(rows: Row[]): Map<string, number> {
  const balance = new Map<string, number>();
  const after = new Map<string, number>();
  for (const row of rows) {
    const next = (balance.get(row.currency) ?? 0) + signedMinor(row);
    balance.set(row.currency, next);
    after.set(row.id, next);
  }
  return after;
}

/** A calendar date for the form's default, or today. */
export function dateOrToday(value: string | undefined, today: CalendarDate): CalendarDate {
  return value && isCalendarDate(value) ? value : today;
}

/** The window of bookings a transaction on `date` may plausibly belong to. */
export function bookingWindow(date: CalendarDate): { from: CalendarDate; to: CalendarDate } {
  return { from: addDays(date, -60), to: addDays(date, 60) };
}

/**
 * The `categoryId` filter (one id, or several comma-separated) without the
 * categories of the other type when a type is chosen (GitLab #129): they
 * would match nothing, and the filter would show a category the type does
 * not offer. Ids of categories not in `categories` (hidden ones) stay.
 * Undefined when none is left.
 */
export function categoriesOfType(
  categoryId: string | undefined,
  type: string | undefined,
  categories: { id: string; type: string }[],
): string | undefined {
  if (!categoryId || (type !== "income" && type !== "expense")) return categoryId;
  const kept = categoryId
    .split(",")
    .filter((id) => !categories.some((c) => c.id === id.trim() && c.type !== type));
  return kept.length > 0 ? kept.join(",") : undefined;
}
