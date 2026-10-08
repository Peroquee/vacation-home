import { apiError, isUuid, notFound, parseBody } from "@/lib/api";
import { updatePropertySchema } from "@/lib/properties/schema";
import { deleteProperty, getProperty, toDto, updateProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/properties/[id]">;

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const property = isUuid(id) ? await getProperty(id) : null;
  return property ? Response.json(toDto(property)) : notFound("Property");
}

/** Updates any subset of fields. Existing bookings keep their own rates. */
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");

  const body = await parseBody(request, updatePropertySchema);
  if ("response" in body) return body.response;

  const property = await updateProperty(id, body.data);
  return property ? Response.json(toDto(property)) : notFound("Property");
}

/**
 * Deletes a property that has no history. One with bookings is refused with a
 * 409: archive it instead (POST /api/properties/:id/archive).
 */
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");

  switch (await deleteProperty(id)) {
    case "deleted":
      return new Response(null, { status: 204 });
    case "not_found":
      return notFound("Property");
    case "has_history":
      return apiError(
        409,
        "conflict",
        "This property has bookings and cannot be deleted. Archive it instead.",
      );
  }
}
