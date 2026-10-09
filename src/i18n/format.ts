/**
 * The money and date formatters (src/lib/format.ts) bound to the language
 * of the request, so components never pass the locale by hand:
 *
 *   const format = useFormat();          // client components
 *   const format = await getFormat();    // server components
 *   format.money(12300, "EUR")           // "123,00 €" in German
 */
import {
  type CalendarDate,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatMoney,
} from "@/lib/format";

import type { Locale } from "./locales";

export function formattersFor(locale: Locale) {
  return {
    locale,
    money: (amountMinor: number, currency: string) =>
      formatMoney(amountMinor, currency, { locale }),
    date: (value: CalendarDate, options: { style?: "short" | "medium" | "long" | "full" } = {}) =>
      formatDate(value, { ...options, locale }),
    dateRange: (start: CalendarDate, end: CalendarDate) => formatDateRange(start, end, { locale }),
    dateTime: (instant: Date | string, timeZone: string) =>
      formatDateTime(instant, timeZone, { locale }),
  };
}

export type Formatters = ReturnType<typeof formattersFor>;
