import { apiError, isUuid, notFound, parseBody } from "@/lib/api";
import { photoOrderSchema } from "@/lib/listing/schema";
import { reorderPhotos } from "@/lib/listing/service";
import { getProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/properties/[id]/photos/order">;

/**
 * Puts the photos in order: `{ ids }`, every photo of the property once; the
 * first is the cover. 409 when the list is not exactly the property's
 * photos (another tab changed them): reload and try again.
 */
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const body = await parseBody(request, photoOrderSchema);
  if ("response" in body) return body.response;
  if (!(await getProperty(id))) return notFound("Property");
  const photos = await reorderPhotos(id, body.data.ids);
  if (photos === "mismatch") {
    return apiError(409, "conflict", "The photos have changed; reload and try again.");
  }
  return Response.json(photos);
}
