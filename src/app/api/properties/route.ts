import { fieldError, parseBody } from "@/lib/api";
import { LEGAL_REQUIRED } from "@/lib/legal/legal";
import { createPropertySchema, SLUG_TAKEN } from "@/lib/properties/schema";
import { createProperty, listProperties, toDto } from "@/lib/properties/service";

/**
 * Lists properties, active ones only unless `?includeArchived=true`.
 * Archived properties drop out of selectors but keep their history.
 */
export async function GET(request: Request) {
  const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
  const properties = await listProperties({ includeArchived });
  return Response.json(properties.map(toDto));
}

/** Creates a property. 422 with per-field messages when the input is invalid. */
export async function POST(request: Request) {
  const body = await parseBody(request, createPropertySchema);
  if ("response" in body) return body.response;

  const property = await createProperty(body.data);
  if (property === "slug_taken") return fieldError("slug", SLUG_TAKEN);
  if (property === "legal_required") return fieldError("publiclyListed", LEGAL_REQUIRED);
  return Response.json(toDto(property), {
    status: 201,
    headers: { Location: `/api/properties/${property.id}` },
  });
}
