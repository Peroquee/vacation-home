import { isUuid, notFound, parseBody } from "@/lib/api";
import { touristTaxSchema } from "@/lib/pricing/schema";
import { getTouristTax, saveTouristTax } from "@/lib/pricing/service";
import { getProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/properties/[id]/tourist-tax">;

/** The property's Kurtaxe rules (GitLab #120): `{ rules }`, null for none. */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id) || !(await getProperty(id))) return notFound("Property");
  return Response.json({ rules: await getTouristTax(id) });
}

/**
 * Replaces the rules, or removes them with `{ rules: null }`. Bookings keep
 * the Kurtaxe they were given; a change of guests re-prices theirs by the
 * rules they were priced under.
 */
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const body = await parseBody(request, touristTaxSchema);
  if ("response" in body) return body.response;
  const saved = await saveTouristTax(id, body.data.rules);
  return saved ? Response.json(saved) : notFound("Property");
}
