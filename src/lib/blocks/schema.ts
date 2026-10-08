/** Input validation for the block API (owner blocks: maintenance, personal use). */
import { z } from "zod";

import { daysBetween, isCalendarDate } from "@/lib/calendar-date";
import { calendarDate, fromBeforeTo, optionalText, page, pageSize } from "@/lib/query";

/** The longest block accepted, in nights: two years. */
export const MAX_BLOCK_NIGHTS = 730;

/**
 * What is wrong with a block's dates, or null: the end must follow the start
 * (half-open, like a stay), within MAX_BLOCK_NIGHTS.
 */
export function blockProblem(startDate: string, endDate: string): string | null {
  const nights = daysBetween(startDate, endDate);
  if (nights < 1) return "must be after the start date";
  if (nights > MAX_BLOCK_NIGHTS) return `a block can be at most ${MAX_BLOCK_NIGHTS} nights`;
  return null;
}

/**
 * Reported on endDate. Zod runs it even after a field's own refinement
 * failed, so it checks the dates' shape first.
 */
function checkDates(dates: { startDate?: string; endDate?: string }, context: z.RefinementCtx) {
  const { startDate, endDate } = dates;
  if (!startDate || !endDate || !isCalendarDate(startDate) || !isCalendarDate(endDate)) return;
  const problem = blockProblem(startDate, endDate);
  if (problem) context.addIssue({ code: "custom", path: ["endDate"], message: problem });
}

const reason = optionalText(200);

/**
 * POST /api/blocks. Always a manual block: blocks from Google Calendar are
 * only ever created by the sync.
 */
export const createBlockSchema = z
  .strictObject({
    propertyId: z.uuid("must be a property id"),
    startDate: calendarDate,
    /** Exclusive: the first night that is free again. */
    endDate: calendarDate,
    reason: reason.optional(),
  })
  .superRefine(checkDates);

/** PATCH /api/blocks/:id: any subset. The property cannot change. */
export const updateBlockSchema = z
  .strictObject({ startDate: calendarDate, endDate: calendarDate, reason })
  .partial()
  .refine((update) => Object.keys(update).length > 0, "at least one field is required")
  .superRefine(checkDates);

/** GET /api/blocks query string. */
export const listBlocksSchema = z
  .object({
    propertyId: z.uuid("must be a property id").optional(),
    /** Blocks overlapping [from, to); either end may be left open. */
    from: calendarDate.optional(),
    to: calendarDate.optional(),
    page,
    pageSize: pageSize(500, 100),
  })
  .refine(...fromBeforeTo);

export type CreateBlockInput = z.infer<typeof createBlockSchema>;
export type UpdateBlockInput = z.infer<typeof updateBlockSchema>;
export type ListBlocksQuery = z.infer<typeof listBlocksSchema>;
