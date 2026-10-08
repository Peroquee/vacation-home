/**
 * Ledger transactions. Server-side only.
 *
 * Amounts are positive integers of minor units in the property's currency
 * (the type gives the direction) - in storage, in the API and in totals;
 * never floats. The database holds the cross-table rules (category type,
 * booking property, currency); the checks here exist to name the field.
 */
import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { MAX_AMOUNT_MINOR } from "@/lib/bookings/pricing";
import { fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";
import { isPrismaError } from "@/lib/db-errors";
import { calendarDate, csv, fromBeforeTo, optionalText, page, pageSize } from "@/lib/query";

import { TRANSACTION_TYPES } from "./categories";

const amountMinor = z
  .int({ error: "must be a whole number of minor units (cents)" })
  .min(1, "must be positive; the type gives the direction")
  .max(MAX_AMOUNT_MINOR, "is too large");
const description = optionalText(500);

export const createTransactionSchema = z.strictObject({
  propertyId: z.uuid("must be a property id"),
  type: z.enum(TRANSACTION_TYPES),
  categoryId: z.uuid("must be a category id"),
  amountMinor,
  date: calendarDate,
  description: description.optional(),
  bookingId: z.uuid("must be a booking id").nullable().optional(),
  isRecurring: z.boolean().default(false),
});

/** Any subset of fields; the property never changes (its currency is the amount's). */
export const updateTransactionSchema = z
  .strictObject({
    type: z.enum(TRANSACTION_TYPES),
    categoryId: z.uuid("must be a category id"),
    amountMinor,
    date: calendarDate,
    description,
    bookingId: z.uuid("must be a booking id").nullable(),
    isRecurring: z.boolean(),
  })
  .partial()
  .refine((update) => Object.keys(update).length > 0, "at least one field is required");

export const listTransactionsSchema = z
  .object({
    propertyId: z.uuid().optional(),
    type: z.enum(TRANSACTION_TYPES).optional(),
    categoryId: csv(z.uuid()),
    /** Dates from `from` (inclusive) to `to` (exclusive), like every range here. */
    from: calendarDate.optional(),
    to: calendarDate.optional(),
    /** Transactions of one booking. */
    bookingId: z.uuid().optional(),
    /** Only those linked to some booking ("true") or to none ("false"). */
    linked: z.enum(["true", "false"]).optional(),
    page,
    pageSize: pageSize(200, 50),
    sort: z.enum(["date", "-date", "amount", "-amount"]).default("-date"),
  })
  .refine(...fromBeforeTo)
  .refine((q) => !(q.bookingId && q.linked), {
    path: ["linked"],
    message: "cannot be combined with bookingId",
  });

export const bulkDeleteSchema = z.strictObject({
  ids: z
    .array(z.uuid("must be transaction ids"))
    .min(1, "is required")
    .max(500, "at most 500 at a time"),
});

const withRelations = {
  category: { select: { id: true, name: true, color: true } },
} satisfies Prisma.TransactionInclude;

type TransactionWithRelations = Prisma.TransactionGetPayload<{ include: typeof withRelations }>;

export function toDto({ date, createdAt, updatedAt, ...rest }: TransactionWithRelations) {
  return {
    ...rest,
    date: fromUtcDate(date),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

export type Invalid = { error: "invalid"; field: string; message: string };
export type TransactionWrite =
  | {
      transaction: TransactionWithRelations;
      /** This edit detached an entry generated from a booking from automation. */
      detached?: boolean;
    }
  | { error: "not_found" }
  | Invalid;

const invalid = (field: string, message: string): Invalid => ({ error: "invalid", field, message });

/** Field-level checks the database would otherwise refuse without saying which field. */
async function checkReferences(
  propertyId: string,
  { type, categoryId, bookingId }: { type: string; categoryId?: string; bookingId?: string | null },
  { newCategory }: { newCategory: boolean },
): Promise<Invalid | null> {
  const [category, booking] = await Promise.all([
    categoryId ? db.category.findUnique({ where: { id: categoryId } }) : null,
    bookingId
      ? db.booking.findUnique({ where: { id: bookingId }, select: { propertyId: true } })
      : null,
  ]);
  if (categoryId) {
    if (!category) return invalid("categoryId", "does not exist");
    if (category.type !== type) return invalid("categoryId", `is not an ${type} category`);
    if (newCategory && category.hidden) return invalid("categoryId", "is hidden");
  }
  if (bookingId) {
    if (!booking) return invalid("bookingId", "does not exist");
    if (booking.propertyId !== propertyId)
      return invalid("bookingId", "belongs to another property");
  }
  return null;
}

/** A foreign key refused the write after all (a race with a delete). */
function refused(error: unknown): Invalid | null {
  return isPrismaError(error, "P2003")
    ? invalid("_", "a referenced record changed; try again")
    : null;
}

export async function createTransaction(
  input: z.infer<typeof createTransactionSchema>,
): Promise<TransactionWrite> {
  const [property, problem] = await Promise.all([
    db.property.findUnique({ where: { id: input.propertyId } }),
    checkReferences(input.propertyId, input, { newCategory: true }),
  ]);
  if (!property) return invalid("propertyId", "does not exist");
  // Like bookings: an archived property takes no new entries.
  if (property.archivedAt) return invalid("propertyId", "is archived");
  if (problem) return problem;

  try {
    const transaction = await db.transaction.create({
      data: {
        propertyId: property.id,
        type: input.type,
        categoryId: input.categoryId,
        amountMinor: input.amountMinor,
        // Always the property's: amounts are minor units of its currency.
        currency: property.currency,
        date: toUtcDate(input.date),
        description: input.description ?? null,
        bookingId: input.bookingId ?? null,
        isRecurring: input.isRecurring,
      },
      include: withRelations,
    });
    return { transaction };
  } catch (error) {
    const problem = refused(error);
    if (problem) return problem;
    throw error;
  }
}

export async function getTransaction(id: string): Promise<TransactionWithRelations | null> {
  return db.transaction.findUnique({ where: { id }, include: withRelations });
}

export async function updateTransaction(
  id: string,
  input: z.infer<typeof updateTransactionSchema>,
): Promise<TransactionWrite> {
  const current = await db.transaction.findUnique({ where: { id } });
  if (!current) return { error: "not_found" };

  const type = input.type ?? current.type;
  if (type !== current.type && input.categoryId === undefined) {
    return invalid("categoryId", `is required when the type changes: an ${type} category`);
  }
  const problem = await checkReferences(
    current.propertyId,
    {
      type,
      categoryId: input.categoryId,
      bookingId: input.bookingId,
    },
    { newCategory: input.categoryId !== undefined && input.categoryId !== current.categoryId },
  );
  if (problem) return problem;

  // Editing a generated entry by hand takes it out of the automation's hands.
  const detaching = current.generated !== null && current.detachedAt === null;
  try {
    const transaction = await db.transaction.update({
      where: { id },
      data: {
        ...(detaching && { detachedAt: new Date() }),
        type: input.type,
        categoryId: input.categoryId,
        amountMinor: input.amountMinor,
        date: input.date === undefined ? undefined : toUtcDate(input.date),
        description: input.description,
        bookingId: input.bookingId,
        isRecurring: input.isRecurring,
      },
      include: withRelations,
    });
    return detaching ? { transaction, detached: true } : { transaction };
  } catch (error) {
    if (isPrismaError(error, "P2025")) return { error: "not_found" };
    const problem = refused(error);
    if (problem) return problem;
    throw error;
  }
}

export async function deleteTransaction(id: string): Promise<boolean> {
  const { count } = await db.transaction.deleteMany({ where: { id } });
  return count > 0;
}

/** Deletes the given transactions; ids that do not exist are ignored. */
export async function deleteTransactions(ids: string[]): Promise<number> {
  const { count } = await db.transaction.deleteMany({ where: { id: { in: ids } } });
  return count;
}

export async function listTransactions(query: z.infer<typeof listTransactionsSchema>) {
  const where: Prisma.TransactionWhereInput = {
    propertyId: query.propertyId,
    type: query.type,
    categoryId: query.categoryId && { in: query.categoryId },
    date: {
      ...(query.from && { gte: toUtcDate(query.from) }),
      ...(query.to && { lt: toUtcDate(query.to) }),
    },
    ...(query.bookingId
      ? { bookingId: query.bookingId }
      : query.linked && { bookingId: query.linked === "true" ? { not: null } : null }),
  };
  const [field, direction] = query.sort.startsWith("-")
    ? [query.sort.slice(1), "desc" as const]
    : [query.sort, "asc" as const];
  const orderBy: Prisma.TransactionOrderByWithRelationInput[] = [
    field === "date" ? { date: direction } : { amountMinor: direction },
    { createdAt: direction },
    { id: "asc" },
  ];

  // One snapshot for the page, the count and the totals, so they agree.
  const [items, count, sums] = await db.$transaction(
    [
      db.transaction.findMany({
        where,
        include: withRelations,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db.transaction.count({ where }),
      db.transaction.groupBy({
        by: ["currency", "type"],
        where,
        orderBy: [{ currency: "asc" }, { type: "asc" }],
        _sum: { amountMinor: true },
      }),
    ],
    { isolationLevel: "RepeatableRead" },
  );

  // Per currency: minor units of different currencies cannot be added up.
  const currencies = [...new Set(sums.map((row) => row.currency))];
  const totals = currencies.map((currency) => {
    const sum = (type: "income" | "expense") =>
      Number(
        sums.find((row) => row.currency === currency && row.type === type)?._sum?.amountMinor ?? 0,
      );
    return {
      currency,
      incomeMinor: sum("income"),
      expenseMinor: sum("expense"),
      netMinor: sum("income") - sum("expense"),
    };
  });

  // Over every matching transaction, not just this page: the ledger's
  // period totals. Integers of minor units, like every amount.
  return { items, total: count, page: query.page, pageSize: query.pageSize, totals };
}
