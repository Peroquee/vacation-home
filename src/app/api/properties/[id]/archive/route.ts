import { isUuid, notFound } from "@/lib/api";
import { setArchived, toDto } from "@/lib/properties/service";

/** Archives a property: hidden from selectors, history kept. Idempotent. */
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/properties/[id]/archive">,
) {
  const { id } = await params;
  const property = isUuid(id) ? await setArchived(id, true) : null;
  return property ? Response.json(toDto(property)) : notFound("Property");
}
