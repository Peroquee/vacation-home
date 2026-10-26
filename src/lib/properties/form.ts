/**
 * Helpers for the property settings form. Client-safe: no database access.
 *
 * The form shows amounts in major units ("180.00", "180,00" in German) while
 * the API takes integer minor units (18000), so these convert between the
 * two through strings, never through a float.
 */

/** Whether amounts are written the German way: 1.234,56 (GitLab #139). */
const german = (locale: string) => locale.startsWith("de");

/** Minor digits of a currency: 2 for EUR, 0 for JPY, 3 for KWD. */
export function minorDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/**
 * 18000 EUR -> "180.00" ("180,00" in German), 1500 JPY -> "1500". Plain
 * digits, no thousands separators, for an input.
 */
export function minorToInput(amountMinor: number, currency: string, locale = "en-GB"): string {
  const digits = minorDigits(currency);
  const padded = String(Math.abs(amountMinor)).padStart(digits + 1, "0");
  const sign = amountMinor < 0 ? "-" : "";
  const mark = german(locale) ? "," : ".";
  return digits === 0
    ? `${sign}${padded}`
    : `${sign}${padded.slice(0, -digits)}${mark}${padded.slice(-digits)}`;
}

/**
 * "180", "180.5" or "180,50" in EUR -> 18000 / 18050 / 18050. Null when the
 * text is not a non-negative amount with at most the currency's minor digits,
 * so the form can say so instead of rounding silently. A blank input is 0.
 *
 * In German (GitLab #139) points may also group thousands: "1.234,56" and
 * "1.234" are 1234.56 and 1234.00, while a point before one or two digits
 * ("12.50") is still a decimal point. In English nothing changes.
 */
export function inputToMinor(text: string, currency: string, locale = "en-GB"): number | null {
  let value = text.trim();
  if (value === "") return 0;
  const digits = minorDigits(currency);
  // A point before three digits is a decimal point in a currency with three.
  if (
    german(locale) &&
    /^\d{1,3}(\.\d{3})+(,\d*)?$/.test(value) &&
    !(digits === 3 && /^\d+\.\d{3}$/.test(value))
  ) {
    value = value.replaceAll(".", "");
  }
  value = value.replace(",", ".");
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value);
  if (!match) return null;
  const [, whole, fraction = ""] = match;
  if (fraction.length > digits) return null;
  const minor = Number(whole + fraction.padEnd(digits, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * Examples for the message on an amount `inputToMinor` refused. In English
 * thousands separators are the usual cause, so the message says to leave
 * them out; in German they may be there.
 */
export function amountExamples(currency: string, locale = "en-GB"): [string] | [string, string] {
  const example = minorToInput(100050, currency, locale);
  if (!/[.,]/.test(example)) return [example];
  return german(locale)
    ? [example, example.replace(/^(\d+)(\d{3}),/, "$1.$2,")]
    : [example, example.replace(".", ",")];
}

/** IANA timezones for the selector, e.g. "Europe/Lisbon". */
export function timeZoneOptions(): string[] {
  return Intl.supportedValuesOf("timeZone");
}

/** ISO 4217 codes with their names, e.g. { code: "EUR", name: "Euro" }. */
export function currencyOptions(locale = "en"): { code: string; name: string }[] {
  const names = new Intl.DisplayNames([locale], { type: "currency" });
  return Intl.supportedValuesOf("currency").map((code) => ({
    code,
    name: names.of(code) ?? code,
  }));
}
