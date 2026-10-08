/**
 * Recurring expenses (GitLab #81): rules for expenses that repeat, and the
 * job that turns each due period into a transaction. Server-side only.
 *
 * - **Occurrences**: occurrence n of a rule falls on its start date plus n
 *   intervals (1, 3 or 12 months), on the same day of the month or the
 *   month's last day when that is shorter: a rule starting 31 January is
 *   due 28/29 February, then 31 March. Computed from the start each time,
 *   so a short month never shifts later dates.
 * - **Exactly one transaction per period**: the rule row is locked while its
 *   due periods are created, and transactions are unique per (rule, date),
 *   so neither a re-run nor two runners at once can double one. A missed run
 *   is caught up by the next: every period due by today is created.
 * - **Today** is the property's local date.
 * - **Pausing** stops creation; the periods that fall due while paused are
 *   skipped when it resumes. Past transactions are never touched. Rules of an
 *   archived property create nothing.
 * - **Deleting** a rule keeps the transactions it created, as history.
 */
import { z } from "zod";

import type { Prisma, RecurrenceInterval, RecurringExpense } from "@/generated/prisma/client";
import { MAX_AMOUNT_MINOR } from "@/lib/bookings/pricing";
import { type CalendarDate, fromUtcDate, isCalendarDate, toUtcDate } from "@/lib/calendar-date";
import { db, type DbClient } from "@/lib/db";
import { isPrismaError } from "@/lib/db-errors";
import { calendarDate, optionalText } from "@/lib/query";

export const RECURRENCE_INTERVALS = ["monthly", "quarterly", "annual"] as const;
const MONTHS: Record<RecurrenceInterval, number> = { monthly: 1, quarterly: 3, annual: 12 };

/** At most this many periods are caught up per rule and run; the next run continues. */
const MAX_CATCH_UP = 240;

/** The date of occurrence `n` of a rule starting on `start`. */
export function occurrenceDate(
  start: CalendarDate,
  interval: RecurrenceInterval,
  n: number,
): CalendarDate {
  const [year, month, day] = start.split("-").map(Number);
  const index = year * 12 + (month - 1) + n * MONTHS[interval];
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

/** The first occurrence index whose date is on or after `date`. */
export function firstOccurrenceFrom(
  start: CalendarDate,
  interval: RecurrenceInterval,
  date: CalendarDate,
): number {
  if (date <= start) return 0;
  const [sy, sm] = start.split("-").map(Number);
  const [dy, dm] = date.split("-").map(Number);
  let n = Math.max(Math.floor(((dy - sy) * 12 + (dm - sm)) / MONTHS[interval]) - 1, 0);
  while (occurrenceDate(start, interval, n) < date) n++;
  return n;
}

/** Today's date where the property is. */
export function todayIn(timezone: string, now = new Date()): CalendarDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}

// --- Validation -------------------------------------------------------------

const amountMinor = z
  .int({ error: "must be a whole number of minor units (cents)" })
  .min(1, "must be positive")
  .max(MAX_AMOUNT_MINOR, "is too large");

/** End before start, reported on endDate; checks the dates' shape first. */
function checkEnd(rule: { startDate?: string; endDate?: string | null }, context: z.RefinementCtx) {
  const { startDate, endDate } = rule;
  if (!startDate || !endDate || !isCalendarDate(startDate) || !isCalendarDate(endDate)) return;
  if (endDate < startDate) {
    context.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "must not be before the start date",
    });
  }
}

export const createRecurringExpenseSchema = z
  .strictObject({
    propertyId: z.uuid("must be a property id"),
    categoryId: z.uuid("must be a category id"),
    amountMinor,
    interval: z.enum(RECURRENCE_INTERVALS),
    /** The first occurrence. Periods already past are created at once. */
    startDate: calendarDate,
    /** The last day an occurrence may fall on. */
    endDate: calendarDate.nullable().optional(),
    description: optionalText(500).optional(),
  })
  .superRefine(checkEnd);

/** PATCH: applies to periods not created yet. Property, interval and start are fixed. */
export const updateRecurringExpenseSchema = z
  .strictObject({
    categoryId: z.uuid("must be a category id"),
    amountMinor,
    endDate: calendarDate.nullable(),
    description: optionalText(500),
  })
  .partial()
  .refine((update) => Object.keys(update).length > 0, "at least one field is required");

export const listRecurringExpensesSchema = z.object({
  propertyId: z.uuid("must be a property id").optional(),
});

// --- DTO ----------------------------------------------------------------------

const withRelations = {
  category: { select: { id: true, name: true, color: true } },
} satisfies Prisma.RecurringExpenseInclude;
type RuleWithRelations = Prisma.RecurringExpenseGetPayload<{ include: typeof withRelations }>;

/** The date the rule creates its next transaction on, or null once it has ended. */
export function nextDueDate(rule: RecurringExpense): CalendarDate | null {
  const next = occurrenceDate(fromUtcDate(rule.startDate), rule.interval, rule.nextOccurrence);
  return rule.endDate && next > fromUtcDate(rule.endDate) ? null : next;
}

export function toDto(rule: RuleWithRelations) {
  const next = nextDueDate(rule);
  return {
    id: rule.id,
    propertyId: rule.propertyId,
    category: rule.category,
    amountMinor: rule.amountMinor,
    currency: rule.currency,
    interval: rule.interval,
    startDate: fromUtcDate(rule.startDate),
    endDate: rule.endDate ? fromUtcDate(rule.endDate) : null,
    description: rule.description,
    status: rule.pausedAt ? "paused" : next === null ? "ended" : "active",
    nextDueDate: next,
    pausedAt: rule.pausedAt?.toISOString() ?? null,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

// --- Materialising ----------------------------------------------------------

/**
 * Creates the transactions for every period of the rule due by `today`
 * (the property's date unless given). Returns how many were created.
 */
export async function materializeRule(ruleId: string, today?: CalendarDate): Promise<number> {
  return db.$transaction(async (tx) => {
    // Locked: a concurrent run waits, then finds the periods already done.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM recurring_expenses WHERE id = ${ruleId}::uuid FOR UPDATE`;
    if (locked.length === 0) return 0;
    const rule = await tx.recurringExpense.findUniqueOrThrow({
      where: { id: ruleId },
      include: { property: { select: { timezone: true, archivedAt: true } } },
    });
    if (rule.pausedAt || rule.property.archivedAt) return 0;

    const until = today ?? todayIn(rule.property.timezone);
    const start = fromUtcDate(rule.startDate);
    const end = rule.endDate ? fromUtcDate(rule.endDate) : null;
    const dates: CalendarDate[] = [];
    let n = rule.nextOccurrence;
    for (; dates.length < MAX_CATCH_UP; n++) {
      const date = occurrenceDate(start, rule.interval, n);
      if (date > until || (end && date > end)) break;
      dates.push(date);
    }
    if (dates.length === 0) return 0;

    const { count } = await tx.transaction.createMany({
      data: dates.map((date) => ({
        propertyId: rule.propertyId,
        type: "expense" as const,
        categoryId: rule.categoryId,
        amountMinor: rule.amountMinor,
        currency: rule.currency,
        date: toUtcDate(date),
        description: rule.description,
        isRecurring: true,
        recurringExpenseId: rule.id,
      })),
      // A period somehow created already stays as it is.
      skipDuplicates: true,
    });
    await tx.recurringExpense.update({ where: { id: rule.id }, data: { nextOccurrence: n } });
    return count;
  });
}

/** Runs every active rule: what the scheduled job does. */
export async function materializeAll(): Promise<{ rules: number; created: number }> {
  const rules = await db.recurringExpense.findMany({
    where: { pausedAt: null, property: { archivedAt: null } },
    select: { id: true },
  });
  let created = 0;
  for (const { id } of rules) created += await materializeRule(id);
  return { rules: rules.length, created };
}

// --- Rules ------------------------------------------------------------------

type Invalid = { error: "invalid"; field: string; message: string };
export type RuleWrite = { rule: RuleWithRelations } | { error: "not_found" } | Invalid;
const invalid = (field: string, message: string): Invalid => ({ error: "invalid", field, message });

async function checkCategory(categoryId: string, client: DbClient = db): Promise<Invalid | null> {
  const category = await client.category.findUnique({ where: { id: categoryId } });
  if (!category) return invalid("categoryId", "does not exist");
  if (category.type !== "expense") return invalid("categoryId", "is not an expense category");
  if (category.hidden) return invalid("categoryId", "is hidden");
  return null;
}

export async function createRecurringExpense(
  input: z.infer<typeof createRecurringExpenseSchema>,
): Promise<RuleWrite> {
  const property = await db.property.findUnique({ where: { id: input.propertyId } });
  if (!property) return invalid("propertyId", "does not exist");
  if (property.archivedAt) return invalid("propertyId", "is archived");
  const problem = await checkCategory(input.categoryId);
  if (problem) return problem;

  try {
    const created = await db.recurringExpense.create({
      data: {
        propertyId: property.id,
        categoryId: input.categoryId,
        amountMinor: input.amountMinor,
        currency: property.currency,
        interval: input.interval,
        startDate: toUtcDate(input.startDate),
        endDate: input.endDate ? toUtcDate(input.endDate) : null,
        description: input.description ?? null,
      },
    });
    // Periods already due (a start date in the past, or today) at once.
    await materializeRule(created.id);
    return {
      rule: await db.recurringExpense.findUniqueOrThrow({
        where: { id: created.id },
        include: withRelations,
      }),
    };
  } catch (error) {
    if (isPrismaError(error, "P2003"))
      return invalid("_", "a referenced record changed; try again");
    throw error;
  }
}

export function listRecurringExpenses(query: z.infer<typeof listRecurringExpensesSchema>) {
  return db.recurringExpense.findMany({
    where: { propertyId: query.propertyId },
    include: withRelations,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export function getRecurringExpense(id: string) {
  return db.recurringExpense.findUnique({ where: { id }, include: withRelations });
}

export async function updateRecurringExpense(
  id: string,
  input: z.infer<typeof updateRecurringExpenseSchema>,
): Promise<RuleWrite> {
  const current = await db.recurringExpense.findUnique({ where: { id } });
  if (!current) return { error: "not_found" };
  if (input.categoryId && input.categoryId !== current.categoryId) {
    const problem = await checkCategory(input.categoryId);
    if (problem) return problem;
  }
  if (input.endDate && input.endDate < fromUtcDate(current.startDate)) {
    return invalid("endDate", "must not be before the start date");
  }
  try {
    const rule = await db.recurringExpense.update({
      where: { id },
      data: {
        categoryId: input.categoryId,
        amountMinor: input.amountMinor,
        endDate:
          input.endDate === undefined ? undefined : input.endDate && toUtcDate(input.endDate),
        description: input.description,
      },
      include: withRelations,
    });
    return { rule };
  } catch (error) {
    if (isPrismaError(error, "P2025")) return { error: "not_found" };
    if (isPrismaError(error, "P2003")) return invalid("categoryId", "does not exist");
    throw error;
  }
}

export async function pauseRecurringExpense(id: string) {
  await db.recurringExpense.updateMany({
    where: { id, pausedAt: null },
    data: { pausedAt: new Date() },
  });
  return getRecurringExpense(id);
}

/**
 * Resumes a paused rule. Periods that fell due while it was paused are
 * skipped: the next one is the first on or after today. Then anything due
 * today is created.
 */
export async function resumeRecurringExpense(id: string, today?: CalendarDate) {
  const rule = await db.recurringExpense.findUnique({
    where: { id },
    include: { property: { select: { timezone: true } } },
  });
  if (!rule) return null;
  if (rule.pausedAt) {
    const from = today ?? todayIn(rule.property.timezone);
    const skipTo = firstOccurrenceFrom(fromUtcDate(rule.startDate), rule.interval, from);
    await db.recurringExpense.updateMany({
      where: { id, pausedAt: { not: null } },
      data: { pausedAt: null, nextOccurrence: Math.max(skipTo, rule.nextOccurrence) },
    });
    await materializeRule(id, today);
  }
  return getRecurringExpense(id);
}

/** Deletes the rule; the transactions it created stay, unlinked. */
export async function deleteRecurringExpense(id: string): Promise<boolean> {
  const { count } = await db.recurringExpense.deleteMany({ where: { id } });
  return count > 0;
}
