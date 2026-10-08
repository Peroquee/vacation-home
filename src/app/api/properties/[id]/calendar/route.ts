import { z } from "zod";

import { fieldError, isUuid, notFound, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import {
  googleFailureResponse,
  setPropertyCalendar,
  toDto,
  writableCalendars,
} from "@/lib/google/calendar-settings";
import { kickOutboundSync } from "@/lib/google/sync-worker";
import { getCurrentUser } from "@/lib/session";

type Context = RouteContext<"/api/properties/[id]/calendar">;

const settingsSchema = z.strictObject({
  calendarId: z.string().trim().min(1, "is required").max(1024),
  outbound: z.boolean().default(true),
  inbound: z.boolean().default(false),
});

/** The property's Google Calendar settings: `{ calendar: {...} | null }`. */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const property = await db.property.findUnique({ where: { id }, include: { calendar: true } });
  if (!property) return notFound("Property");
  return Response.json({ calendar: property.calendar ? toDto(property.calendar) : null });
}

/**
 * Chooses the property's calendar: `{ calendarId, outbound?, inbound? }`.
 * The calendar must be one the signed-in user can write to (422 otherwise);
 * the sync then uses their Google connection. Every current booking is
 * scheduled: pushed to this calendar, and removed from a previous one.
 */
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const body = await parseBody(request, settingsSchema);
  if ("response" in body) return body.response;
  const property = await db.property.findUnique({ where: { id }, select: { id: true } });
  if (!property) return notFound("Property");

  const user = await getCurrentUser();
  let calendars;
  try {
    calendars = await writableCalendars(user!.id);
  } catch (error) {
    const response = googleFailureResponse(error);
    if (response) return response;
    throw error;
  }
  const calendar = calendars.find((c) => c.id === body.data.calendarId);
  if (!calendar) {
    return fieldError("calendarId", "is not a calendar you can write to");
  }

  const config = await setPropertyCalendar(id, user!.id, {
    ...body.data,
    calendarName: calendar.summary,
  });
  kickOutboundSync();
  return Response.json({ calendar: toDto(config) });
}

/**
 * Stops syncing the property (204). Events already in Google are left
 * untouched; choosing the same calendar again updates them rather than
 * adding copies.
 */
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  await db.propertyCalendar.deleteMany({ where: { propertyId: id } });
  return new Response(null, { status: 204 });
}
