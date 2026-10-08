/**
 * Money and date formatting, in the configured locale (see ./locale).
 *
 * Use these rather than `toLocaleString` or `Intl` directly, so every page
 * shows amounts and dates the same way.
 */
import { type CalendarDate, toUtcDate } from "@/lib/calendar-date";
import { APP_LOCALE } from "@/lib/locale";

type FormatOptions = {
  /** Override the configured locale, e.g. in tests or for an export. */
  locale?: string;
};

// --- Money ------------------------------------------------------------------

/**
 * Formats an amount held in **minor units** (cents, pence; yen have none) as
 * a currency string: `formatMoney(123450, "EUR")` -> "€1,234.50".
 *
 * Amounts are integers in minor units everywhere in this app, never floats,
 * so that sums of nightly rates and fees cannot drift by a cent. The number
 * of minor digits comes from the currency itself: `formatMoney(1500, "JPY")`
 * is "¥1,500".
 */
export function formatMoney(
  amountMinor: number,
  currency: string,
  { locale = APP_LOCALE }: FormatOptions = {},
): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`formatMoney expects integer minor units, got ${amountMinor}`);
  }

  const format = currencyFormat(locale, currency);
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  // Place the decimal point in the digit string rather than dividing, so the
  // amount never passes through a float. Intl formats decimal strings exactly.
  const sign = amountMinor < 0 ? "-" : "";
  const padded = String(Math.abs(amountMinor)).padStart(digits + 1, "0");
  const decimal = digits === 0 ? padded : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
  return format.format(`${sign}${decimal}` as `${number}`);
}

// Building an Intl formatter is far slower than using one, and a table of
// amounts would otherwise build one per cell.
const currencyFormats = new Map<string, Intl.NumberFormat>();

function currencyFormat(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  let format = currencyFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, { style: "currency", currency });
    currencyFormats.set(key, format);
  }
  return format;
}

// --- Dates ------------------------------------------------------------------

export type { CalendarDate } from "@/lib/calendar-date";

type DateStyle = "short" | "medium" | "long" | "full";

/**
 * Formats a calendar date: `formatDate("2026-07-14")` -> "Jul 14, 2026".
 * The weekday is included with `style: "full"`.
 */
export function formatDate(
  value: CalendarDate,
  { style = "medium", locale = APP_LOCALE }: FormatOptions & { style?: DateStyle } = {},
): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: style, timeZone: "UTC" }).format(
    toUtcDate(value),
  );
}

/**
 * Formats a stay, collapsing what the two ends share:
 * `formatDateRange("2026-07-14", "2026-07-18")` -> "Jul 14 – 18, 2026".
 */
export function formatDateRange(
  start: CalendarDate,
  end: CalendarDate,
  { style = "medium", locale = APP_LOCALE }: FormatOptions & { style?: DateStyle } = {},
): string {
  const from = toUtcDate(start);
  const to = toUtcDate(end);
  // A check-out before the check-in is bad data; showing it as a plausible
  // stay would hide that.
  if (to < from) {
    throw new RangeError(`formatDateRange: end ${end} is before start ${start}`);
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: style, timeZone: "UTC" }).formatRange(
    from,
    to,
  );
}

/**
 * Formats an instant (a sync time, a payment timestamp) in a given IANA
 * timezone - normally the property's, so a booking made at 23:30 in Lisbon
 * does not display as the next day for an owner in another zone:
 * `formatDateTime(date, "Europe/Lisbon")` -> "Jul 14, 2026, 11:30 PM".
 */
export function formatDateTime(
  value: Date | string,
  timeZone: string,
  { locale = APP_LOCALE }: FormatOptions = {},
): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`formatDateTime got an invalid date: "${String(value)}"`);
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}
