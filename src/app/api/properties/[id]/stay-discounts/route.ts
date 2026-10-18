import { isUuid, notFound, parseBody } from "@/lib/api";
import { stayDiscountsSchema } from "@/lib/pricing/schema";
import { listDiscounts, saveDiscounts } from "@/lib/pricing/service";
import { getProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/properties/[id]/stay-discounts">;

/**
 * The property's length-of-stay discounts (GitLab #119): `{ tiers: [{
 * minNights, percent }] }`, fewest nights first. The highest tier a stay
 * reaches comes off its nights' sum.
 */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id) || !(await getProperty(id))) return notFound("Property");
  return Response.json({ tiers: await listDiscounts(id) });
}

/**
 * Replaces every tier; an empty list means no discount. 422 for a night
 * count given twice, fewer than 2 or more than 365 nights, or a percentage
 * outside 1-90. Bookings keep the price they were given.
 */
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const body = await parseBody(request, stayDiscountsSchema);
  if ("response" in body) return body.response;
  const tiers = await saveDiscounts(id, body.data.tiers);
  return tiers ? Response.json({ tiers }) : notFound("Property");
}
