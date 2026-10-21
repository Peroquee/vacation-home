/**
 * The ledger as CSV (GitLab #83): every transaction matching the ledger's
 * filters, oldest first, in the documented columns (./csv.ts). Server-side
 * only.
 */
import { z } from "zod";

import { fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";
import { calendarDate, csv, fromBeforeTo } from "@/lib/query";

import { TRANSACTION_TYPES } from "./categories";
import { type CsvFormat, toCsv } from "./csv";
import { receiptsFilter, receiptsWhere } from "./transactions";

/** Generous for a holiday home's books; beyond it, export a shorter range. */
export const MAX_EXPORT_ROWS = 50_000;

export const exportSchema = z
  .object({
    propertyId: z.uuid().optional(),
    type: z.enum(TRANSACTION_TYPES).optional(),
    categoryId: csv(z.uuid()),
    /** Dates from `from` (inclusive) to `to` (exclusive), like the ledger. */
    from: calendarDate.optional(),
    to: calendarDate.optional(),
    receipts: receiptsFilter,
    format: z.enum(["standard", "excel-de"]).default("standard"),
  })
  .refine(...fromBeforeTo);

export async function exportTransactions(
  query: z.infer<typeof exportSchema>,
): Promise<{ csv: string; count: number } | { tooMany: number }> {
  const where = {
    propertyId: query.propertyId,
    type: query.type,
    categoryId: query.categoryId && { in: query.categoryId },
    date: {
      ...(query.from && { gte: toUtcDate(query.from) }),
      ...(query.to && { lt: toUtcDate(query.to) }),
    },
    ...receiptsWhere(query.receipts),
  };
  const count = await db.transaction.count({ where });
  if (count > MAX_EXPORT_ROWS) return { tooMany: count };
  const items = await db.transaction.findMany({
    where,
    include: { category: { select: { name: true } }, property: { select: { name: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const csvText = toCsv(
    items.map((t) => ({
      date: fromUtcDate(t.date),
      type: t.type,
      amountMinor: t.amountMinor,
      currency: t.currency,
      category: t.category.name,
      property: t.property.name,
      description: t.description,
      bookingId: t.bookingId,
      id: t.id,
    })),
    query.format as CsvFormat,
  );
  return { csv: csvText, count: items.length };
}
