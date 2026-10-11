import { isUuid, notFound, parseBody } from "@/lib/api";
import { photoSchema } from "@/lib/listing/schema";
import { deletePhoto, updatePhoto } from "@/lib/listing/service";

type Context = RouteContext<"/api/properties/[id]/photos/[photoId]">;

/** Changes a photo's alternative text (`altEn`, `altDe`). */
export async function PATCH(request: Request, { params }: Context) {
  const { id, photoId } = await params;
  if (!isUuid(id) || !isUuid(photoId)) return notFound("Photo");
  const body = await parseBody(request, photoSchema);
  if ("response" in body) return body.response;
  const photo = await updatePhoto(id, photoId, body.data);
  return photo ? Response.json(photo) : notFound("Photo");
}

/** Removes a photo (204); its files go once nothing else uses them. */
export async function DELETE(_request: Request, { params }: Context) {
  const { id, photoId } = await params;
  if (!isUuid(id) || !isUuid(photoId) || !(await deletePhoto(id, photoId))) {
    return notFound("Photo");
  }
  return new Response(null, { status: 204 });
}
