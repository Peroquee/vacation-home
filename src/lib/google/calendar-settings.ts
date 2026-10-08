/**
 * Choosing a property's Google Calendar (PropertyCalendar), for the settings
 * screen. Server-side only.
 */
import type { PropertyCalendar } from "@/generated/prisma/client";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";

import { type CalendarListEntry, createCalendarClient, GoogleCalendarError } from "./calendar";
import { CalendarNotConnectedError } from "./connection";
import { scheduleProperty } from "./outbound";

/** Calendars the app can write events to: the user's own, or shared with write access. */
export async function writableCalendars(userId: string): Promise<CalendarListEntry[]> {
  const calendars = await createCalendarClient({ userId }).listCalendars();
  return calendars.filter((c) => c.accessRole === "owner" || c.accessRole === "writer");
}

/**
 * The response for a Google failure while serving a settings request, or
 * null for anything else (rethrow it).
 */
export function googleFailureResponse(error: unknown): Response | null {
  if (error instanceof CalendarNotConnectedError) {
    return apiError(409, "conflict", error.message, undefined, { reason: error.reason });
  }
  if (error instanceof GoogleCalendarError) {
    return apiError(
      502,
      "upstream_unavailable",
      "Google Calendar could not be reached; try again.",
      undefined,
      {
        kind: error.kind,
      },
    );
  }
  return null;
}

export function toDto(config: PropertyCalendar) {
  return {
    propertyId: config.propertyId,
    calendarId: config.calendarId,
    calendarName: config.calendarName,
    outbound: config.outbound,
    inbound: config.inbound,
    /** Whose Google connection the sync uses. */
    userId: config.userId,
    updatedAt: config.updatedAt.toISOString(),
  };
}

/**
 * Sets the property's calendar, through `userId`'s Google connection, and
 * schedules every current booking: pushed to the new calendar, and removed
 * from a previous one.
 */
export async function setPropertyCalendar(
  propertyId: string,
  userId: string,
  settings: {
    calendarId: string;
    calendarName: string | null;
    outbound: boolean;
    inbound: boolean;
  },
): Promise<PropertyCalendar> {
  const config = await db.propertyCalendar.upsert({
    where: { propertyId },
    create: { propertyId, userId, ...settings },
    update: { userId, ...settings },
  });
  // Links made from now on write through the new owner's connection.
  await db.calendarEventLink.updateMany({
    where: { booking: { propertyId }, calendarId: settings.calendarId },
    data: { userId },
  });
  await scheduleProperty(propertyId);
  return config;
}
