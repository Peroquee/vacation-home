/**
 * CSV for the ledger (GitLab #83): the export's documented columns, and the
 * pieces of an import that read a cell. Pure and client-safe; the import
 * itself (validation against the database, duplicates) is in ./import.ts.
 *
 * **Export columns**, in this order:
 *
 * | Column        | Holds                                                     |
 * | ------------- | --------------------------------------------------------- |
 * | `date`        | YYYY-MM-DD                                                |
 * | `type`        | `income` or `expense`                                     |
 * | `amount`      | Positive, in the currency's minor digits, no thousands separator: `1234.50` (`1234,50` in the Excel format) |
 * | `currency`    | ISO 4217, e.g. `EUR`                                      |
 * | `category`    | The category's name                                       |
 * | `property`    | The property's name                                       |
 * | `description` | Free text, may be empty                                   |
 * | `booking_id`  | The linked booking's id, or empty                         |
 * | `id`          | The transaction's id, so a re-import recognises it        |
 *
 * Two formats: `standard` (comma-separated, decimal point) and `excel-de`
 * (semicolon-separated, decimal comma, as German Excel opens it). Both are
 * UTF-8 with a byte order mark, so Excel reads umlauts right.
 */
import { minorToInput } from "@/lib/properties/form";

export const EXPORT_COLUMNS = [
  "date",
  "type",
  "amount",
  "currency",
  "category",
  "property",
  "description",
  "booking_id",
  "id",
] as const;

export type CsvFormat = "standard" | "excel-de";

export type ExportRow = {
  date: string;
  type: "income" | "expense";
  amountMinor: number;
  currency: string;
  category: string;
  property: string;
  description: string | null;
  bookingId: string | null;
  id: string;
};

/**
 * A text cell made safe for spreadsheets: one starting with = + - @ (or a
 * tab or carriage return) would run as a formula, so it gets a leading
 * apostrophe, which spreadsheets hide. The import takes it off again.
 */
export function guardFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function cell(value: string, delimiter: string): string {
  return /["\r\n]/.test(value) || value.includes(delimiter)
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

export function toCsv(rows: ExportRow[], format: CsvFormat): string {
  const delimiter = format === "excel-de" ? ";" : ",";
  const line = (cells: string[]) => cells.map((c) => cell(c, delimiter)).join(delimiter);
  const amount = (row: ExportRow) => {
    const text = minorToInput(row.amountMinor, row.currency, "en-GB");
    return format === "excel-de" ? text.replace(".", ",") : text;
  };
  return (
    "﻿" +
    [
      line([...EXPORT_COLUMNS]),
      ...rows.map((row) =>
        line([
          row.date,
          row.type,
          amount(row),
          row.currency,
          guardFormula(row.category),
          guardFormula(row.property),
          guardFormula(row.description ?? ""),
          row.bookingId ?? "",
          row.id,
        ]),
      ),
    ].join("\r\n") +
    "\r\n"
  );
}

// --- Reading cells ---------------------------------------------------------------

/** Takes off the apostrophe `guardFormula` put in front of a formula-like text. */
export function unguard(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

/**
 * A calendar date from "2026-07-14", "14.07.2026" or "14.7.2026" (the German
 * way). Other orders (07/14/2026 or 14/07/2026) are ambiguous, so refused.
 */
export function parseDate(text: string): string | null {
  const value = text.trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const [y, m, d] = match
    ? [match[1]!, match[2]!, match[3]!]
    : (match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value))
      ? [match[3]!, match[2]!.padStart(2, "0"), match[1]!.padStart(2, "0")]
      : [];
  if (!y) return null;
  const date = `${y}-${m}-${d}`;
  const check = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === date ? date : null;
}

function minorDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/**
 * A signed amount in minor units from what spreadsheets and banks write:
 * "1234.50", "1234,50", "1,234.50", "1.234,50", "-12,00", "12,00-", "(12.00)",
 * "€ 12,00". The last separator followed by the currency's minor digits (or
 * fewer) is the decimal one; the others group thousands. Null for anything
 * else, or more decimals than the currency has: never rounded.
 */
export function parseAmount(text: string, currency: string): number | null {
  let value = text.trim().replace(/[\s  ']/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(value)) [negative, value] = [true, value.slice(1, -1)];
  if (value.endsWith("-")) [negative, value] = [true, value.slice(0, -1)];
  if (value.startsWith("-")) [negative, value] = [!negative, value.slice(1)];
  else if (value.startsWith("+")) value = value.slice(1);
  value = value.replace(/^[^\d.,]+|[^\d.,]+$/g, ""); // a currency sign or code
  if (!/^[\d.,]+$/.test(value) || !/\d/.test(value)) return null;

  const digits = minorDigits(currency);
  const last = Math.max(value.lastIndexOf("."), value.lastIndexOf(","));
  let whole = value;
  let fraction = "";
  if (last >= 0) {
    const tail = value.slice(last + 1);
    const separators = value.match(/[.,]/g)!;
    const decimal =
      // "1.234" with three digits after a lone separator in a currency with
      // two minor digits groups thousands; anything else is a decimal part.
      !(separators.length === 1 && tail.length === 3 && digits !== 3) &&
      // Several of the same separator only group thousands: "1.234.567".
      !(separators.length > 1 && separators.every((s) => s === value[last]));
    if (decimal) {
      whole = value.slice(0, last);
      fraction = tail;
    }
  }
  // Thousands groups must be groups of three.
  const groups = whole.split(/[.,]/);
  if (groups.length > 1 && groups.slice(1).some((g) => g.length !== 3)) return null;
  whole = groups.join("");
  if (whole === "" && fraction === "") return null;
  if (fraction.length > digits) return null;

  const minor = Number((whole || "0") + fraction.padEnd(digits, "0"));
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

/** "income", "expense", or their German or signed forms; null when unknown. */
export function parseType(text: string): "income" | "expense" | null {
  const value = text.trim().toLowerCase();
  if (["income", "einnahme", "einnahmen", "in", "+"].includes(value)) return "income";
  if (["expense", "expenses", "ausgabe", "ausgaben", "out", "-"].includes(value)) return "expense";
  return null;
}

// --- Mapping ---------------------------------------------------------------------

export const IMPORT_FIELDS = [
  "date",
  "amount",
  "type",
  "category",
  "property",
  "description",
  "bookingId",
  "id",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Which column (0-based) holds each field; unmapped fields are absent. */
export type ColumnMapping = Partial<Record<ImportField, number>>;

const HEADER_NAMES: Record<ImportField, string[]> = {
  date: ["date", "datum", "buchungstag", "valuta", "booking date"],
  amount: ["amount", "betrag", "summe", "value", "wert"],
  type: ["type", "art", "typ"],
  category: ["category", "kategorie"],
  property: ["property", "unterkunft", "objekt"],
  description: ["description", "beschreibung", "verwendungszweck", "text", "memo", "notes"],
  bookingId: ["booking_id", "booking", "buchung"],
  id: ["id"],
};

/** A first guess at the mapping from the header row: this app's own columns and common names. */
export function guessMapping(header: string[]): ColumnMapping {
  const names = header.map((h) => h.trim().toLowerCase());
  const mapping: ColumnMapping = {};
  for (const field of IMPORT_FIELDS) {
    const index = names.findIndex((name) => HEADER_NAMES[field].includes(name));
    if (index >= 0) mapping[field] = index;
  }
  return mapping;
}
