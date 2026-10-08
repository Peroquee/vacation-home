/**
 * Sync issues for review (GitLab #74): what inbound sync could not settle
 * on its own. Server-side only.
 */
import { z } from "zod";

import type { CalendarSyncIssue } from "@/generated/prisma/client";
import { fromUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

export const listIssuesSchema = z.object({
  propertyId: z.uuid("must be a property id").optional(),
  status: z.enum(["open", "all"]).default("open"),
});

const MESSAGES: Record<CalendarSyncIssue["kind"], string> = {
  inbound_overlap:
    "A Google Calendar event overlaps a confirmed booking, so it was not imported as a block. Check the dates in Google or in the booking.",
};

export function toDto(issue: CalendarSyncIssue) {
  return {
    id: issue.id,
    propertyId: issue.propertyId,
    kind: issue.kind,
    message: MESSAGES[issue.kind],
    calendarId: issue.calendarId,
    googleEventId: issue.googleEventId,
    bookingIds: issue.bookingIds,
    startDate: fromUtcDate(issue.startDate),
    endDate: fromUtcDate(issue.endDate),
    detectedAt: issue.detectedAt.toISOString(),
    resolvedAt: issue.resolvedAt?.toISOString() ?? null,
    resolution: issue.resolution,
  };
}

export function listIssues(query: z.infer<typeof listIssuesSchema>) {
  return db.calendarSyncIssue.findMany({
    where: { propertyId: query.propertyId, ...(query.status === "open" && { resolvedAt: null }) },
    orderBy: [{ detectedAt: "desc" }, { id: "asc" }],
  });
}

/** Marks an issue as seen and dealt with. Dismissing twice is harmless. */
export async function dismissIssue(id: string): Promise<CalendarSyncIssue | null> {
  await db.calendarSyncIssue.updateMany({
    where: { id, resolvedAt: null },
    data: { resolvedAt: new Date(), resolution: "dismissed" },
  });
  return db.calendarSyncIssue.findUnique({ where: { id } });
}

/** Open issues on the properties whose calendar the user's connection syncs. */
export function openIssueCount(userId: string): Promise<number> {
  return db.calendarSyncIssue.count({
    where: { resolvedAt: null, property: { calendar: { userId } } },
  });
}
