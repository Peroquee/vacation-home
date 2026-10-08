/**
 * Writing owner blocks. Server-side only.
 *
 * Like bookings, every write happens under the property's lock
 * (`withPropertyLock`), after checking that no confirmed booking shares a
 * night with the block, so a refusal can name the bookings in the way. The
 * database's booking/block trigger backs this up; should it fire anyway, it
 * is reported the same way. Blocks may overlap each other.
 *
 * Blocks imported from Google Calendar (`origin: google`) belong to the
 * sync: this API refuses to change or delete them.
 *
 * Manual blocks are deleted outright: they are not accounting records.
 */
import type { Block, Prisma } from "@/generated/prisma/client";
import { invalidateWindows } from "@/lib/availability/cache";
import { type Conflict, isOverlapViolation, withPropertyLock } from "@/lib/availability/service";
import { type CalendarDate, fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import { db, type DbClient } from "@/lib/db";

import {
  blockProblem,
  type CreateBlockInput,
  type ListBlocksQuery,
  type UpdateBlockInput,
} from "./schema";

/** The API's view of a block: dates as YYYY-MM-DD. */
export function toDto(block: Block) {
  return {
    id: block.id,
    propertyId: block.propertyId,
    startDate: fromUtcDate(block.startDate),
    endDate: fromUtcDate(block.endDate),
    reason: block.reason,
    origin: block.origin,
    /** Imported from Google Calendar: change it there, not here. */
    readOnly: block.origin === "google",
    createdAt: block.createdAt.toISOString(),
    updatedAt: block.updatedAt.toISOString(),
  };
}

export type BlockDto = ReturnType<typeof toDto>;

export type BlockWriteResult =
  | { block: Block }
  | { error: "not_found" }
  | { error: "read_only" }
  | { error: "invalid"; field: string; message: string }
  | { error: "conflict"; conflicts: Conflict[] };

type Dates = { startDate: CalendarDate; endDate: CalendarDate };

/** Confirmed bookings sharing a night with the dates: what a block may not overlap. */
async function bookingsInTheWay(
  client: DbClient,
  propertyId: string,
  { startDate, endDate }: Dates,
): Promise<Conflict[]> {
  const bookings = await client.booking.findMany({
    where: {
      propertyId,
      status: "confirmed",
      checkIn: { lt: toUtcDate(endDate) },
      checkOut: { gt: toUtcDate(startDate) },
    },
    select: { id: true, checkIn: true, checkOut: true },
    orderBy: { checkIn: "asc" },
  });
  return bookings.map((b) => ({
    kind: "booking",
    id: b.id,
    start: fromUtcDate(b.checkIn),
    end: fromUtcDate(b.checkOut),
  }));
}

/**
 * Runs a block write under the property's lock, reporting the trigger's
 * overlap refusal as the bookings now in the way.
 */
async function locked(
  propertyId: string,
  work: (tx: DbClient) => Promise<BlockWriteResult>,
  dates: () => Dates,
): Promise<BlockWriteResult | null> {
  try {
    return await withPropertyLock(propertyId, work);
  } catch (error) {
    if (!isOverlapViolation(error)) throw error;
    return { error: "conflict", conflicts: await bookingsInTheWay(db, propertyId, dates()) };
  }
}

export async function createBlock(input: CreateBlockInput): Promise<BlockWriteResult> {
  const property = await db.property.findUnique({
    where: { id: input.propertyId },
    select: { archivedAt: true },
  });
  const noProperty = { error: "invalid", field: "propertyId", message: "does not exist" } as const;
  if (!property) return noProperty;
  if (property.archivedAt) return { error: "invalid", field: "propertyId", message: "is archived" };

  const result =
    (await locked(
      input.propertyId,
      async (tx) => {
        const conflicts = await bookingsInTheWay(tx, input.propertyId, input);
        if (conflicts.length > 0) return { error: "conflict", conflicts };
        const block = await tx.block.create({
          data: {
            propertyId: input.propertyId,
            startDate: toUtcDate(input.startDate),
            endDate: toUtcDate(input.endDate),
            reason: input.reason ?? null,
            origin: "manual",
          },
        });
        return { block };
      },
      () => input,
    )) ?? noProperty;
  if ("block" in result) {
    invalidateWindows(input.propertyId, [{ start: input.startDate, end: input.endDate }]);
  }
  return result;
}

export function getBlock(id: string): Promise<Block | null> {
  return db.block.findUnique({ where: { id } });
}

/**
 * Applies a partial update, reading the block afresh under the lock. New
 * dates are checked against confirmed bookings again.
 */
export async function updateBlock(id: string, input: UpdateBlockInput): Promise<BlockWriteResult> {
  const head = await db.block.findUnique({ where: { id }, select: { propertyId: true } });
  if (!head) return { error: "not_found" };

  let before = { start: "", end: "" };
  let dates: Dates = { startDate: "", endDate: "" };
  const result =
    (await locked(
      head.propertyId,
      async (tx) => {
        const current = await tx.block.findUnique({ where: { id } });
        if (!current) return { error: "not_found" };
        if (current.origin === "google") return { error: "read_only" };
        before = { start: fromUtcDate(current.startDate), end: fromUtcDate(current.endDate) };
        dates = {
          startDate: input.startDate ?? before.start,
          endDate: input.endDate ?? before.end,
        };
        // With one end given, the schema could not judge the range.
        const problem = blockProblem(dates.startDate, dates.endDate);
        if (problem) {
          const field = input.endDate === undefined ? "startDate" : "endDate";
          return { error: "invalid", field, message: problem };
        }
        if (dates.startDate !== before.start || dates.endDate !== before.end) {
          const conflicts = await bookingsInTheWay(tx, head.propertyId, dates);
          if (conflicts.length > 0) return { error: "conflict", conflicts };
        }
        const block = await tx.block.update({
          where: { id },
          data: {
            startDate: toUtcDate(dates.startDate),
            endDate: toUtcDate(dates.endDate),
            reason: input.reason,
          },
        });
        return { block };
      },
      () => dates,
    )) ?? ({ error: "not_found" } as const);
  if ("block" in result) {
    invalidateWindows(head.propertyId, [before, { start: dates.startDate, end: dates.endDate }]);
  }
  return result;
}

/** Deletes a manual block. */
export async function deleteBlock(
  id: string,
): Promise<{ deleted: true } | { error: "not_found" } | { error: "read_only" }> {
  const head = await db.block.findUnique({ where: { id }, select: { propertyId: true } });
  if (!head) return { error: "not_found" };
  const result = await withPropertyLock(head.propertyId, async (tx) => {
    const current = await tx.block.findUnique({ where: { id } });
    if (!current) return { error: "not_found" } as const;
    if (current.origin === "google") return { error: "read_only" } as const;
    await tx.block.delete({ where: { id } });
    return {
      deleted: true,
      range: { start: fromUtcDate(current.startDate), end: fromUtcDate(current.endDate) },
    } as const;
  });
  if (!result) return { error: "not_found" };
  if ("error" in result) return result;
  invalidateWindows(head.propertyId, [result.range]);
  return { deleted: true };
}

/** Blocks matching `query`, by start date, one page at a time. */
export async function listBlocks(query: ListBlocksQuery) {
  const where: Prisma.BlockWhereInput = {
    propertyId: query.propertyId,
    // Overlapping [from, to): ending after `from`, starting before `to`.
    endDate: query.from ? { gt: toUtcDate(query.from) } : undefined,
    startDate: query.to ? { lt: toUtcDate(query.to) } : undefined,
  };
  const [items, total] = await db.$transaction([
    db.block.findMany({
      where,
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.block.count({ where }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}
