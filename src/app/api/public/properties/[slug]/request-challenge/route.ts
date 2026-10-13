import { notFound } from "@/lib/api";
import { createRequestChallenge } from "@/lib/booking-requests/challenge";
import { getListedProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/public/properties/[slug]/request-challenge">;

/**
 * GET: a new proof-of-work challenge for the request form (GitLab #109),
 * signed and bound to this property; see src/lib/booking-requests/challenge.ts.
 */
export async function GET(_request: Request, { params }: Context) {
  const { slug } = await params;
  const property = await getListedProperty(slug);
  if (!property) return notFound("Property");
  return Response.json(await createRequestChallenge(property.slug), {
    headers: { "Cache-Control": "no-store" },
  });
}
