import { apiError, isUuid, notFound } from "@/lib/api";
import { db } from "@/lib/db";
import { scheduleProperty } from "@/lib/google/outbound";
import { kickOutboundSync } from "@/lib/google/sync-worker";

/**
 * "Resync everything": schedules every current booking of the property
 * (checking out at most 30 days ago) for a push. 202 `{ scheduled: n }`;
 * 409 when the property has no calendar or outbound sync is off.
 */
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/properties/[id]/calendar/resync">,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const property = await db.property.findUnique({ where: { id }, include: { calendar: true } });
  if (!property) return notFound("Property");
  if (!property.calendar?.outbound) {
    return apiError(409, "conflict", "Outbound sync is off for this property.", undefined, {
      reason: "sync_off",
    });
  }
  const scheduled = await scheduleProperty(id);
  kickOutboundSync();
  return Response.json({ scheduled }, { status: 202 });
}
