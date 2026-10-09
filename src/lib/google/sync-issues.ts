/**
 * Sync issues for review (GitLab #74): what inbound sync could not settle
 * on its own - a Google event (`inbound_overlap`) or a booking platform's
 * stay (`ical_overlap`, GitLab #99) overlapping a confirmed booking.
 * Server-side only.
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
  ical_overlap:
    "A booking platform has a stay on dates of a confirmed booking: a double booking. Cancel one of them, on the platform or here.",
};

export function toDto(issue: CalendarSyncIssue & { feed?: { name: string } | null }) {
  return {
    id: issue.id,
    propertyId: issue.propertyId,
    kind: issue.kind,
    message: MESSAGES[issue.kind],
    calendarId: issue.calendarId,
    googleEventId: issue.googleEventId,
    feedId: issue.feedId,
    /** The feed's name ("Airbnb"), for `ical_overlap`. */
    feedName: issue.feed?.name ?? null,
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
    include: { feed: { select: { name: true } } },
    orderBy: [{ detectedAt: "desc" }, { id: "asc" }],
  });
}

/** Marks an issue as seen and dealt with. Dismissing twice is harmless. */
export async function dismissIssue(id: string): Promise<CalendarSyncIssue | null> {
  await db.calendarSyncIssue.updateMany({
    where: { id, resolvedAt: null },
    data: { resolvedAt: new Date(), resolution: "dismissed" },
  });
  return db.calendarSyncIssue.findUnique({
    where: { id },
    include: { feed: { select: { name: true } } },
  });
}

/** Open Google issues on the properties whose calendar the user's connection syncs. */
export function openIssueCount(userId: string): Promise<number> {
  return db.calendarSyncIssue.count({
    where: { kind: "inbound_overlap", resolvedAt: null, property: { calendar: { userId } } },
  });
}

/** Open double bookings with a booking platform, on active properties. */
export function openDoubleBookings() {
  return db.calendarSyncIssue.findMany({
    where: { kind: "ical_overlap", resolvedAt: null, property: { archivedAt: null } },
    include: { feed: { select: { name: true } }, property: { select: { name: true } } },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
}
