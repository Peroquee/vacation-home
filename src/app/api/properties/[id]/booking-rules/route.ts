import { isUuid, notFound, parseBody } from "@/lib/api";
import { bookingRulesSchema } from "@/lib/booking-rules/schema";
import { getBookingRules, saveBookingRules } from "@/lib/booking-rules/service";
import { getProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/properties/[id]/booking-rules">;

/**
 * The property's booking rules (GitLab #107): `minNights`, `maxNights`,
 * `minLeadDays`, `horizonDays`, `checkInWeekdays` and `bufferDays`. A
 * property without rules of its own gets the defaults, which allow anything.
 */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id) || !(await getProperty(id))) return notFound("Property");
  return Response.json(await getBookingRules(id));
}

/** Replaces the rules; every field is required. */
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const body = await parseBody(request, bookingRulesSchema);
  if ("response" in body) return body.response;
  if (!(await getProperty(id))) return notFound("Property");
  return Response.json(await saveBookingRules(id, body.data));
}
