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

const KEYS = ["month", "propertyId", "type", "categoryId"] as const;
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
