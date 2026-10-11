import { notFound } from "@/lib/api";
import { getPublicProperty } from "@/lib/listing/public";

type Context = RouteContext<"/api/public/properties/[slug]">;

/**
 * A listed property's public face, for the booking site (no session): the
 * profile in both languages and the photo URLs (src/lib/properties/public.ts
 * lists every field). An unlisted, archived or missing property is the same
 * 404, so the answer reveals nothing about properties that are not listed.
 */
export async function GET(_request: Request, { params }: Context) {
  const property = await getPublicProperty((await params).slug);
  return property ? Response.json(property) : notFound("Property");
}
