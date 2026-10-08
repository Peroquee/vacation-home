import { z } from "zod";

import { isUuid, notFound, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Context = RouteContext<"/api/properties/[id]/income-automation">;

const settingsSchema = z.strictObject({
  enabled: z.boolean(),
  /** What happens to generated entries when the booking is cancelled. */
  onCancel: z.enum(["delete", "zero"]).default("delete"),
});

const OFF = { enabled: false, onCancel: "delete" as const };

/**
 * Whether confirmed bookings of the property create their income entries:
 * `{ enabled, onCancel: "delete" | "zero" }`. Off unless turned on.
 */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const property = await db.property.findUnique({
    where: { id },
    select: { incomeAutomation: { select: { enabled: true, onCancel: true } } },
  });
  if (!property) return notFound("Property");
  return Response.json(property.incomeAutomation ?? OFF);
}

/**
 * Turns income automation on or off. It applies to bookings confirmed or
 * changed from then on; existing bookings are not backfilled, so entries
 * already typed in by hand are never doubled.
 */
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const body = await parseBody(request, settingsSchema);
  if ("response" in body) return body.response;
  const property = await db.property.findUnique({ where: { id }, select: { id: true } });
  if (!property) return notFound("Property");
  const settings = await db.incomeAutomation.upsert({
    where: { propertyId: id },
    create: { propertyId: id, ...body.data },
    update: body.data,
    select: { enabled: true, onCancel: true },
  });
  return Response.json(settings);
}
