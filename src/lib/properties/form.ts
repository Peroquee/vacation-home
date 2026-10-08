/**
 * Helpers for the property settings form. Client-safe: no database access.
 *
 * The form shows amounts in major units ("180.00") while the API takes integer
 * minor units (18000), so these convert between the two through strings,
 * never through a float.
 */

/** Minor digits of a currency: 2 for EUR, 0 for JPY, 3 for KWD. */
export function minorDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/** 18000 EUR -> "180.00", 1500 JPY -> "1500". Plain digits, for an input. */
export function minorToInput(amountMinor: number, currency: string): string {
  const digits = minorDigits(currency);
  const padded = String(Math.abs(amountMinor)).padStart(digits + 1, "0");
  const sign = amountMinor < 0 ? "-" : "";
  return digits === 0
    ? `${sign}${padded}`
    : `${sign}${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}

/**
 * "180", "180.5" or "180,50" in EUR -> 18000 / 18050 / 18050. Null when the
 * text is not a non-negative amount with at most the currency's minor digits,
 * so the form can say so instead of rounding silently. A blank input is 0.
 */
export function inputToMinor(text: string, currency: string): number | null {
  const value = text.trim().replace(",", ".");
  if (value === "") return 0;
  const digits = minorDigits(currency);
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value);
  if (!match) return null;
  const [, whole, fraction = ""] = match;
  if (fraction.length > digits) return null;
  const minor = Number(whole + fraction.padEnd(digits, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
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
