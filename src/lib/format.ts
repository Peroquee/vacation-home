/**
 * Money and date formatting, in the configured locale (see ./locale).
 *
 * Use these rather than `toLocaleString` or `Intl` directly, so every page
 * shows amounts and dates the same way.
 */
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

  const format = new Intl.NumberFormat(locale, { style: "currency", currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amountMinor / 10 ** digits);
}

// --- Dates ------------------------------------------------------------------

/**
 * A calendar date, "YYYY-MM-DD", with no time and no timezone: what a check-in
 * or check-out is. Kept apart from instants on purpose: rendering a calendar
 * date through a `Date` in the viewer's timezone shows the wrong day for
 * anyone west of UTC.
 */
export type CalendarDate = string;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a calendar date to midnight UTC, rejecting impossible dates. */
function parseCalendarDate(value: CalendarDate): Date {
  const match = CALENDAR_DATE.exec(value);
  if (match) {
    const [, y, m, d] = match.map(Number);
    const date = new Date(Date.UTC(y!, m! - 1, d!));
    // Date.UTC rolls 2026-02-30 over into March; refuse instead.
    if (date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d) {
      return date;
    }
  }
  throw new RangeError(`Expected a calendar date as YYYY-MM-DD, got "${value}"`);
}

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
    parseCalendarDate(value),
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
  return new Intl.DateTimeFormat(locale, { dateStyle: style, timeZone: "UTC" }).formatRange(
    parseCalendarDate(start),
    parseCalendarDate(end),
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
