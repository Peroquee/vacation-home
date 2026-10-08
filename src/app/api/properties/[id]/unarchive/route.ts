import { isUuid, notFound } from "@/lib/api";
import { setArchived, toDto } from "@/lib/properties/service";

/** Restores an archived property. Idempotent. */
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/properties/[id]/unarchive">,
) {
  const { id } = await params;
  const property = isUuid(id) ? await setArchived(id, false) : null;
  return property ? Response.json(toDto(property)) : notFound("Property");
}
