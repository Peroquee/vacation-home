/**
 * The analytics service: loads bookings, blocks and ledger totals for a
 * range (and its prior period, in the same queries) and applies the rules
 * in ./rules.ts. One aggregation layer, so the dashboard only displays.
 * Server-side only.
 */
import { BOOKED_STATUSES } from "@/lib/bookings/values";
import { z } from "zod";

import { daysBetween, fromUtcDate, isCalendarDate, toUtcDate } from "@/lib/calendar-date";
import type { DateRange } from "@/lib/date-range";
import { db } from "@/lib/db";
import { calendarDate, fromBeforeTo } from "@/lib/query";

import {
  compare,
  type Comparison,
  ledgerByMonth,
  monthlySeries,
  nightStats,
  priorRange,
  summarise,
} from "./rules";

/** The longest range one query may cover: three years. */
export const MAX_RANGE_DAYS = 3 * 366;

const flag = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((value) =>
      value === undefined || value === "" ? fallback : value === "true" || value === "1",
    );

/** GET /api/analytics query string. */
export const analyticsQuerySchema = z
  .object({
    /** The range, half-open: `to` is the first day not included. */
    from: calendarDate,
    to: calendarDate,
    propertyId: z.uuid("must be a property id").optional(),
    compare: z.enum(["year", "previous"]).default("year"),
    /** Leave blocked nights out of the available nights (default). */
    excludeBlocks: flag(true),
  })
  .refine(...fromBeforeTo)
  .refine(
    // Runs even after a field failed, so it checks the dates' shape first.
    (q) =>
      !isCalendarDate(q.from) ||
      !isCalendarDate(q.to) ||
      q.from >= q.to ||
      daysBetween(q.from, q.to) <= MAX_RANGE_DAYS,
    { path: ["to"], message: `the range can be at most ${MAX_RANGE_DAYS} days` },
  );

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export type AnalyticsResult =
  | { error: "not_found" }
  | { error: "mixed_currencies"; currencies: string[] }
  | { report: Awaited<ReturnType<typeof buildReport>> };

export async function getAnalytics(query: AnalyticsQuery): Promise<AnalyticsResult> {
  const properties = await db.property.findMany({
    where: query.propertyId ? { id: query.propertyId } : {},
    select: { id: true, currency: true, archivedAt: true },
  });
  if (query.propertyId && properties.length === 0) return { error: "not_found" };
  // Amounts in different currencies cannot be added up.
  const currencies = [...new Set(properties.map((p) => p.currency))].sort();
  if (currencies.length > 1) return { error: "mixed_currencies", currencies };
  return { report: await buildReport(query, properties, currencies[0] ?? null) };
}

async function buildReport(
  query: AnalyticsQuery,
  properties: { id: string; currency: string; archivedAt: Date | null }[],
  currency: string | null,
) {
  const range: DateRange = { start: query.from, end: query.to };
  const prior = priorRange(range, query.compare as Comparison);
  // One load covering both periods.
  const span = {
    start: prior.start < range.start ? prior.start : range.start,
    end: prior.end > range.end ? prior.end : range.end,
  };
  const propertyIds = properties.map((p) => p.id);
  const overlapping = { lt: toUtcDate(span.end) };

  const [bookings, blocks, ledgerRows, expenseRows] = await db.$transaction([
    db.booking.findMany({
      where: {
        propertyId: { in: propertyIds },
        // Booked stays: a reservation awaiting its deposit does not count yet.
        status: { in: [...BOOKED_STATUSES] },
        checkIn: overlapping,
        checkOut: { gt: toUtcDate(span.start) },
      },
      select: {
        propertyId: true,
        checkIn: true,
        checkOut: true,
        totalAmountMinor: true,
        cleaningFeeMinor: true,
        touristTaxMinor: true,
      },
    }),
    db.block.findMany({
      where: {
        propertyId: { in: propertyIds },
        startDate: overlapping,
        endDate: { gt: toUtcDate(span.start) },
      },
      select: { propertyId: true, startDate: true, endDate: true },
    }),
    db.transaction.groupBy({
      by: ["date", "type"],
      where: {
        propertyId: { in: propertyIds },
        // Money collected for someone else (the Kurtaxe) is not revenue.
        category: { passThrough: false },
        date: { gte: toUtcDate(span.start), lt: toUtcDate(span.end) },
      },
      orderBy: [{ date: "asc" }, { type: "asc" }],
      _sum: { amountMinor: true },
    }),
    db.transaction.groupBy({
      by: ["categoryId"],
      where: {
        propertyId: { in: propertyIds },
        type: "expense",
        date: { gte: toUtcDate(range.start), lt: toUtcDate(range.end) },
      },
      orderBy: { categoryId: "asc" },
      _sum: { amountMinor: true },
    }),
  ]);

  const propertyInputs = properties.map((p) => ({
    id: p.id,
    archivedOn: p.archivedAt ? p.archivedAt.toISOString().slice(0, 10) : null,
  }));
  const bookingInputs = bookings.map((b) => ({
    ...b,
    checkIn: fromUtcDate(b.checkIn),
    checkOut: fromUtcDate(b.checkOut),
  }));
  const blockInputs = blocks.map((b) => ({
    propertyId: b.propertyId,
    startDate: fromUtcDate(b.startDate),
    endDate: fromUtcDate(b.endDate),
  }));
  const ledger = ledgerRows.map((row) => ({
    date: fromUtcDate(row.date),
    type: row.type,
    amountMinor: row._sum?.amountMinor ?? 0,
  }));
  const options = { excludeBlocks: query.excludeBlocks };
  const seriesFor = (r: DateRange) =>
    monthlySeries(
      r,
      nightStats(r, propertyInputs, bookingInputs, blockInputs, options),
      ledgerByMonth(r, ledger),
    );

  const months = seriesFor(range);
  const totals = summarise(months);
  const priorTotals = summarise(seriesFor(prior));

  // Collected for someone else (the Kurtaxe, GitLab #120): reported on its
  // own, never in the income above.
  const passThrough = await db.transaction.aggregate({
    where: {
      propertyId: { in: propertyIds },
      category: { passThrough: true },
      date: { gte: toUtcDate(range.start), lt: toUtcDate(range.end) },
    },
    _sum: { amountMinor: true },
  });

  const categories = await db.category.findMany({
    where: { id: { in: expenseRows.map((row) => row.categoryId) } },
    select: { id: true, name: true, color: true },
  });
  const byId = new Map(categories.map((c) => [c.id, c]));
  const expensesByCategory = expenseRows
    .map((row) => {
      const category = byId.get(row.categoryId)!;
      const amountMinor = row._sum?.amountMinor ?? 0;
      return {
        categoryId: row.categoryId,
        name: category.name,
        color: category.color,
        amountMinor,
        share:
          totals.expensesMinor === 0
            ? null
            : Math.round((amountMinor / totals.expensesMinor) * 10_000) / 10_000,
      };
    })
    .sort((a, b) => b.amountMinor - a.amountMinor || a.name.localeCompare(b.name));

  return {
    currency,
    range: { from: range.start, to: range.end },
    excludeBlocks: query.excludeBlocks,
    months: months.map(({ start, end, ...month }) => ({ ...month, from: start, to: end })),
    totals,
    prior: { compare: query.compare, from: prior.start, to: prior.end, totals: priorTotals },
    change: compare(totals, priorTotals),
    expensesByCategory,
    passThroughMinor: passThrough._sum.amountMinor ?? 0,
  };
}
