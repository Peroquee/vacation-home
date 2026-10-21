/**
 * Importing ledger rows from a CSV file (GitLab #83). Server-side only.
 *
 * The browser reads the file and sends its rows with a column mapping
 * (src/lib/finance/csv.ts). Every request checks every row; `commit` then
 * writes the ones that passed, in one database transaction:
 *
 * - **Per row**, never all or nothing: a malformed row is reported with its
 *   line number and each field's problem, and the others still import.
 * - **Duplicates** are rows that match a transaction already in the ledger,
 *   or an earlier row of the same file, by property, type, date, amount and
 *   description (case and spacing ignored); or that carry the `id` of one
 *   (a re-imported export). They are skipped unless the user confirms them
 *   by line (`include`), since two equal coffees on one day can be real.
 * - **Exact**: amounts are read in the property's currency without rounding
 *   (`parseAmount`), so an exported file comes back to the cent.
 */
import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { MAX_AMOUNT_MINOR } from "@/lib/bookings/pricing";
import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

import {
  type ColumnMapping,
  IMPORT_FIELDS,
  parseAmount,
  parseDate,
  parseType,
  unguard,
} from "./csv";

export const MAX_IMPORT_ROWS = 5000;

const column = z.int().min(0).max(99);

export const importSchema = z.strictObject({
  /** The data rows, without the header. */
  rows: z
    .array(z.array(z.string().max(2000)).max(100))
    .min(1, "is required")
    .max(MAX_IMPORT_ROWS, `at most ${MAX_IMPORT_ROWS} rows at a time`),
  /** The file's line number of the first row, for messages (2 after a header). */
  firstLine: z.int().min(1).default(2),
  mapping: z
    .strictObject(Object.fromEntries(IMPORT_FIELDS.map((f) => [f, column.optional()])))
    .refine((m) => m.date !== undefined, { path: ["date"], message: "is required" })
    .refine((m) => m.amount !== undefined, { path: ["amount"], message: "is required" }),
  /** Used where the file has no such column, or leaves it empty. */
  defaults: z
    .strictObject({
      propertyId: z.uuid("must be a property id").optional(),
      incomeCategoryId: z.uuid("must be a category id").optional(),
      expenseCategoryId: z.uuid("must be a category id").optional(),
    })
    .default({}),
  commit: z.boolean().default(false),
  /** Lines of duplicates to import anyway. */
  include: z.array(z.int()).max(MAX_IMPORT_ROWS).default([]),
});

export type ImportRequest = z.infer<typeof importSchema>;

export type RowError = { field: string; message: string };

export type ImportRow = {
  line: number;
  status: "ready" | "duplicate" | "invalid" | "imported" | "skipped";
  errors: RowError[];
  /** What the row is a duplicate of: a ledger entry, or an earlier line. */
  duplicateOf: { transactionId: string } | { line: number } | null;
  /** The transaction the row makes, for the preview; null when invalid. */
  draft: {
    date: string;
    type: "income" | "expense";
    amountMinor: number;
    currency: string;
    category: string;
    property: string;
    description: string | null;
  } | null;
};

type Draft = {
  propertyId: string;
  categoryId: string;
  bookingId: string | null;
  date: string;
  type: "income" | "expense";
  amountMinor: number;
  currency: string;
  description: string | null;
};

const normalise = (text: string | null) => (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const keyOf = (d: Pick<Draft, "propertyId" | "type" | "date" | "amountMinor" | "description">) =>
  [d.propertyId, d.type, d.date, d.amountMinor, normalise(d.description)].join("|");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The default categories are each of their own type (GitLab #129): an
 * income category as the expenses' default is refused, naming the field,
 * rather than every row without a category failing on it.
 */
export async function checkImportDefaults(
  defaults: ImportRequest["defaults"],
): Promise<{ field: string; message: string } | null> {
  for (const type of ["income", "expense"] as const) {
    const field = type === "income" ? "incomeCategoryId" : "expenseCategoryId";
    const id = defaults[field];
    if (!id) continue;
    const category = await db.category.findUnique({ where: { id }, select: { type: true } });
    if (!category) return { field: `defaults.${field}`, message: "does not exist" };
    if (category.type !== type) {
      return { field: `defaults.${field}`, message: `is not an ${type} category` };
    }
  }
  return null;
}

/** Checks every row; with `commit`, writes the ready ones (and confirmed duplicates). */
export async function importTransactions(request: ImportRequest): Promise<{
  rows: ImportRow[];
  summary: Record<ImportRow["status"], number>;
}> {
  const { rows, mapping, defaults } = request;
  const cell = (row: string[], field: keyof ColumnMapping) => {
    const index = mapping[field];
    return index === undefined ? "" : unguard((row[index] ?? "").trim());
  };

  const [properties, categories] = await Promise.all([
    db.property.findMany({ select: { id: true, name: true, currency: true, archivedAt: true } }),
    db.category.findMany({ select: { id: true, name: true, type: true } }),
  ]);
  const bookingIds = [
    ...new Set(rows.map((r) => cell(r, "bookingId")).filter((id) => UUID.test(id))),
  ];
  const sourceIds = [...new Set(rows.map((r) => cell(r, "id")).filter((id) => UUID.test(id)))];
  const [bookings, existingById] = await Promise.all([
    db.booking.findMany({
      where: { id: { in: bookingIds } },
      select: { id: true, propertyId: true },
    }),
    db.transaction.findMany({ where: { id: { in: sourceIds } }, select: { id: true } }),
  ]);
  const bookingProperty = new Map(bookings.map((b) => [b.id, b.propertyId]));
  const knownIds = new Set(existingById.map((t) => t.id));

  const findProperty = (text: string) => {
    const wanted = text.toLowerCase();
    return properties.find((p) => p.id === text || p.name.toLowerCase() === wanted);
  };
  const findCategory = (text: string, type: "income" | "expense") => {
    const wanted = text.toLowerCase();
    return categories.find(
      (c) => c.type === type && (c.id === text || c.name.toLowerCase() === wanted),
    );
  };

  const checked = rows.map((row, i) => {
    const line = request.firstLine + i;
    const errors: RowError[] = [];
    const fail = (field: string, message: string) => errors.push({ field, message });

    const propertyText = cell(row, "property");
    const property = propertyText
      ? findProperty(propertyText)
      : properties.find((p) => p.id === defaults.propertyId);
    if (!property) fail("property", propertyText ? "does not exist" : "is required");
    else if (property.archivedAt) fail("property", "is archived");

    const date = parseDate(cell(row, "date"));
    if (!date) fail("date", "must be a date like 2026-07-14 or 14.07.2026");

    const amountText = cell(row, "amount");
    const signed = property ? parseAmount(amountText, property.currency) : null;
    if (property && signed === null) {
      fail("amount", amountText ? "must be an amount like 1234.50 or 1.234,50" : "is required");
    } else if (signed === 0) fail("amount", "must not be zero");
    else if (signed !== null && Math.abs(signed) > MAX_AMOUNT_MINOR) fail("amount", "is too large");

    const typeText = cell(row, "type");
    const type =
      mapping.type !== undefined && typeText
        ? parseType(typeText)
        : signed !== null
          ? signed < 0
            ? "expense"
            : "income"
          : null;
    if (mapping.type !== undefined && typeText && !type) {
      fail("type", "must be income or expense");
    }

    const categoryText = cell(row, "category");
    const category = type
      ? categoryText
        ? findCategory(categoryText, type)
        : categories.find(
            (c) =>
              c.type === type &&
              c.id === (type === "income" ? defaults.incomeCategoryId : defaults.expenseCategoryId),
          )
      : undefined;
    if (type && !category) {
      fail(
        "category",
        categoryText
          ? type === "income"
            ? "is not an income category"
            : "is not an expense category"
          : "is required",
      );
    }

    const description = cell(row, "description") || null;
    if (description && description.length > 500) {
      fail("description", "must be at most 500 characters");
    }

    const bookingText = cell(row, "bookingId");
    let bookingId: string | null = null;
    if (bookingText) {
      const owner = bookingProperty.get(bookingText);
      if (!owner) fail("bookingId", "does not exist");
      else if (property && owner !== property.id) {
        fail("bookingId", "belongs to another property");
      } else bookingId = bookingText;
    }

    const draft: Draft | null =
      errors.length === 0 && property && date && type && category && signed !== null
        ? {
            propertyId: property.id,
            categoryId: category.id,
            bookingId,
            date,
            type,
            amountMinor: Math.abs(signed),
            currency: property.currency,
            description,
          }
        : null;
    const sourceId = cell(row, "id");
    return {
      line,
      errors,
      draft,
      preview: draft && {
        date: draft.date,
        type: draft.type,
        amountMinor: draft.amountMinor,
        currency: draft.currency,
        category: category!.name,
        property: property!.name,
        description: draft.description,
      },
      knownId: UUID.test(sourceId) && knownIds.has(sourceId) ? sourceId : null,
    };
  });

  // Duplicates: against the ledger over the file's dates, and within the file.
  const drafts = checked.flatMap((c) => (c.draft ? [c.draft] : []));
  const ledger = new Map<string, string>();
  if (drafts.length > 0) {
    const dates = drafts.map((d) => d.date).sort();
    const where: Prisma.TransactionWhereInput = {
      propertyId: { in: [...new Set(drafts.map((d) => d.propertyId))] },
      date: { gte: toUtcDate(dates[0]!), lte: toUtcDate(dates.at(-1)!) },
    };
    const existing = await db.transaction.findMany({
      where,
      select: {
        id: true,
        propertyId: true,
        type: true,
        date: true,
        amountMinor: true,
        description: true,
      },
    });
    for (const t of existing) {
      ledger.set(keyOf({ ...t, date: t.date.toISOString().slice(0, 10) }), t.id);
    }
  }
  const seen = new Map<string, number>();
  const include = new Set(request.include);

  const result: ImportRow[] = checked.map((c) => {
    if (!c.draft) {
      return { line: c.line, status: "invalid", errors: c.errors, duplicateOf: null, draft: null };
    }
    const key = keyOf(c.draft);
    const duplicateOf = c.knownId
      ? { transactionId: c.knownId }
      : ledger.has(key)
        ? { transactionId: ledger.get(key)! }
        : seen.has(key)
          ? { line: seen.get(key)! }
          : null;
    if (!seen.has(key)) seen.set(key, c.line);
    return {
      line: c.line,
      status: duplicateOf ? "duplicate" : "ready",
      errors: [],
      duplicateOf,
      draft: c.preview,
    };
  });

  if (request.commit) {
    const toWrite = checked.filter(
      (c, i) =>
        c.draft &&
        (result[i]!.status === "ready" ||
          (result[i]!.status === "duplicate" && include.has(c.line))),
    );
    await db.transaction.createMany({
      data: toWrite.map(({ draft }) => ({
        propertyId: draft!.propertyId,
        categoryId: draft!.categoryId,
        bookingId: draft!.bookingId,
        type: draft!.type,
        amountMinor: draft!.amountMinor,
        currency: draft!.currency,
        date: toUtcDate(draft!.date),
        description: draft!.description,
      })),
    });
    const written = new Set(toWrite.map((c) => c.line));
    for (const row of result) {
      if (row.status === "invalid") continue;
      row.status = written.has(row.line) ? "imported" : "skipped";
    }
  }

  const summary = { ready: 0, duplicate: 0, invalid: 0, imported: 0, skipped: 0 };
  for (const row of result) summary[row.status]++;
  return { rows: result, summary };
}
