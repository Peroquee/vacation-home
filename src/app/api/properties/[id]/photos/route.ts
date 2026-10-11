import { apiError, fieldError, isUuid, notFound } from "@/lib/api";
import { MAX_PHOTO_BYTES } from "@/lib/listing/photo-processing";
import { addPhoto, listPhotos } from "@/lib/listing/service";
import { MAX_PHOTOS } from "@/lib/listing/values";
import { getProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/properties/[id]/photos">;

/** The property's listing photos in display order, the cover first (GitLab #106). */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id) || !(await getProperty(id))) return notFound("Property");
  return Response.json(await listPhotos(id));
}

/**
 * Adds a photo: multipart form data with `file` (JPEG, PNG or WebP, up to
 * 20 MB). Stored re-encoded, without metadata, last in the order. 201 with
 * the photo; 422 for a wrong file or one photo too many.
 */
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  // Refused before reading: the form is the file plus a little.
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_PHOTO_BYTES + 512 * 1024) return fieldError("file", "is larger than 20 MB");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, "invalid_json", "The request body is not valid form data.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fieldError("file", "is required");
  const result = await addPhoto(id, new Uint8Array(await file.arrayBuffer()));
  if ("photo" in result) return Response.json(result.photo, { status: 201 });
  if (result.error === "not_found") return notFound("Property");
  if (result.error === "too_many") {
    return fieldError("file", `is one too many: at most ${MAX_PHOTOS} photos per property`);
  }
  return fieldError("file", result.message);
}
