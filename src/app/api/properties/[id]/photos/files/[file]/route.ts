import { isUuid, notFound } from "@/lib/api";
import { photoFileResponse } from "@/lib/listing/photo-files";
import { photoFileOf } from "@/lib/listing/service";

type Context = RouteContext<"/api/properties/[id]/photos/files/[file]">;

/**
 * A stored photo size (`<sha256>.webp`), for the owner's settings: any
 * property's, listed or not. Signed in only (src/proxy.ts).
 */
export async function GET(_request: Request, { params }: Context) {
  const { id, file } = await params;
  const sha256 = isUuid(id) ? await photoFileOf(id, file) : null;
  return sha256 ? photoFileResponse(sha256, "private") : notFound("Photo");
}
