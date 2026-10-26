/**
 * The per-property switch for booking income (GitLab #80, #137). Server-side
 * only. On by default: a new property is created with it on, and the
 * migration 20261025040000_income_automation_on turned it on for the
 * properties that had no settings. A property without settings (made
 * directly in the database, as tests do) counts as off.
 *
 * Switching it on brings in the bookings already confirmed (a backfill);
 * switching it off takes out the generated entries nobody edited by hand.
 * Both run in one transaction under the property lock, like a booking
 * write, so the ledger never shows half of either.
 */
import type { CancelledIncome } from "@/generated/prisma/client";
import { withPropertyLock } from "@/lib/availability/service";
import { BOOKED_STATUSES } from "@/lib/bookings/values";
import type { DbClient } from "@/lib/db";
import { db } from "@/lib/db";

import { hasHandIncome, syncBookingIncome } from "./booking-income";

export type IncomeSettings = { enabled: boolean; onCancel: CancelledIncome };

/** What a property without settings has. */
export const INCOME_OFF: IncomeSettings = { enabled: false, onCancel: "delete" };
/** What a new property starts with. */
export const INCOME_DEFAULT: IncomeSettings = { enabled: true, onCancel: "delete" };

/** The property's settings, or null when there is no such property. */
export async function getIncomeAutomation(propertyId: string): Promise<IncomeSettings | null> {
  const property = await db.property.findUnique({
    where: { id: propertyId },
    select: { incomeAutomation: { select: { enabled: true, onCancel: true } } },
  });
  if (!property) return null;
  return property.incomeAutomation ?? INCOME_OFF;
}

/** The settings of each of the properties (all of them existing). */
export async function getIncomeAutomationFor(
  propertyIds: string[],
): Promise<Map<string, IncomeSettings>> {
  const rows = await db.incomeAutomation.findMany({
    where: { propertyId: { in: propertyIds } },
    select: { propertyId: true, enabled: true, onCancel: true },
  });
  const byProperty = new Map(
    rows.map(({ propertyId, ...settings }) => [propertyId, settings] as const),
  );
  return new Map(propertyIds.map((id) => [id, byProperty.get(id) ?? INCOME_OFF]));
}

export type SetResult = IncomeSettings & {
  /** Generated entries the switch created (switched on). */
  added: number;
  /** Generated entries it took out (switched off). */
  removed: number;
};

/**
 * Saves the settings. Switched on, the bookings already confirmed get their
 * entries; switched off, the untouched generated entries go. `onCancel`
 * applies to cancellations from then on. Null when there is no property.
 */
export async function setIncomeAutomation(
  propertyId: string,
  settings: IncomeSettings,
): Promise<SetResult | null> {
  return withPropertyLock(propertyId, async (tx) => {
    const before = await tx.incomeAutomation.findUnique({ where: { propertyId } });
    const saved = await tx.incomeAutomation.upsert({
      where: { propertyId },
      create: { propertyId, ...settings },
      update: settings,
      select: { enabled: true, onCancel: true },
    });
    const was = before?.enabled ?? false;
    let added = 0;
    let removed = 0;
    if (!was && saved.enabled) added = (await backfillPropertyIncome(propertyId, tx)).entries;
    if (was && !saved.enabled) removed = await removeGeneratedIncome(propertyId, tx);
    return { ...saved, added, removed };
  });
}

export type Backfill = {
  /** Bookings that got entries. */
  bookings: number;
  entries: number;
  amountMinor: number;
  /** Booked bookings left alone: income typed in by hand is linked to them. */
  skipped: number;
};

/**
 * Creates the missing entries of every booked booking of the property: not
 * for those with payments (their income is the payments'), nor for those
 * with no entries yet and hand-typed income linked. Entries edited by hand
 * stay as they are. Idempotent. Call it in the property's lock, with its
 * income automation on.
 */
export async function backfillPropertyIncome(propertyId: string, tx: DbClient): Promise<Backfill> {
  const bookings = await tx.booking.findMany({
    where: { propertyId, status: { in: [...BOOKED_STATUSES] }, payments: { none: {} } },
    select: { id: true },
    orderBy: { checkIn: "asc" },
  });
  const generated = async (bookingId: string) => {
    const { _count, _sum } = await tx.transaction.aggregate({
      where: { bookingId, generated: { not: null } },
      _count: true,
      _sum: { amountMinor: true },
    });
    return { count: _count, amountMinor: _sum.amountMinor ?? 0 };
  };
  const result: Backfill = { bookings: 0, entries: 0, amountMinor: 0, skipped: 0 };
  for (const { id } of bookings) {
    const before = await generated(id);
    if (before.count === 0 && (await hasHandIncome(tx, id))) {
      result.skipped += 1;
      continue;
    }
    await syncBookingIncome(id, tx, { backfill: true });
    const after = await generated(id);
    if (after.count <= before.count) continue;
    result.bookings += 1;
    result.entries += after.count - before.count;
    result.amountMinor += after.amountMinor - before.amountMinor;
  }
  return result;
}

/** Deletes the property's generated entries nobody edited by hand. */
export async function removeGeneratedIncome(propertyId: string, tx: DbClient): Promise<number> {
  const { count } = await tx.transaction.deleteMany({
    where: { propertyId, generated: { not: null }, detachedAt: null },
  });
  return count;
}

export type UnlinkedIncome = {
  category: string;
  count: number;
  amountMinor: number;
  from: Date;
  to: Date;
};

/**
 * Income typed in by hand that is linked to no booking, by category: it may
 * be a booking's income that a backfill would count a second time, which
 * only the owner can tell.
 */
export async function unlinkedHandIncome(
  propertyId: string,
  client: DbClient = db,
): Promise<UnlinkedIncome[]> {
  const groups = await client.transaction.groupBy({
    by: ["categoryId"],
    where: { propertyId, type: "income", bookingId: null, generated: null, paymentId: null },
    _count: true,
    _sum: { amountMinor: true },
    _min: { date: true },
    _max: { date: true },
  });
  if (groups.length === 0) return [];
  const categories = await client.category.findMany({
    where: { id: { in: groups.map((g) => g.categoryId) } },
    select: { id: true, name: true },
  });
  const name = new Map(categories.map((c) => [c.id, c.name]));
  return groups
    .map((g) => ({
      category: name.get(g.categoryId) ?? g.categoryId,
      count: g._count,
      amountMinor: g._sum.amountMinor ?? 0,
      from: g._min.date!,
      to: g._max.date!,
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}
