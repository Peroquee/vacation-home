import { notFound } from "@/lib/api";
import { photoFileResponse } from "@/lib/listing/photo-files";
import { photoFileOf } from "@/lib/listing/service";
import { getListedProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/public/properties/[slug]/photos/[file]">;

/**
 * A listed property's photo size (`<sha256>.webp`), for its public page. A
 * file that is not one of its photos, or a property that is not listed, is
 * the same 404.
 */
export async function GET(_request: Request, { params }: Context) {
  const { slug, file } = await params;
  const property = await getListedProperty(slug);
  const sha256 = property ? await photoFileOf(property.id, file) : null;
  return sha256 ? photoFileResponse(sha256, "public") : notFound("Photo");
}
