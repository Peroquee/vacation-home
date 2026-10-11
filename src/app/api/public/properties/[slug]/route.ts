import { notFound } from "@/lib/api";
import { toPublicDto } from "@/lib/properties/public";
import { getListedProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/public/properties/[slug]">;

/**
 * A listed property's public face, for the booking site (no session). An
 * unlisted, archived or missing property is the same 404, so the answer
 * reveals nothing about properties that are not listed.
 */
export async function GET(_request: Request, { params }: Context) {
  const { slug } = await params;
  const property = await getListedProperty(slug);
  return property ? Response.json(toPublicDto(property)) : notFound("Property");
}
