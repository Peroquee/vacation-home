import { isUuid, notFound, parseBody } from "@/lib/api";
import { stayTimesSchema } from "@/lib/listing/schema";
import { getStayTimes, saveStayTimes } from "@/lib/listing/service";
import { getProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/properties/[id]/stay-times">;

/** The property's arrival and departure times (GitLab #126); unset until saved. */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id) || !(await getProperty(id))) return notFound("Property");
  return Response.json(await getStayTimes(id));
}

/**
 * Replaces the three times; missing ones are unset. Bookings already
 * reserved or made keep theirs.
 */
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const body = await parseBody(request, stayTimesSchema);
  if ("response" in body) return body.response;
  if (!(await getProperty(id))) return notFound("Property");
  return Response.json(await saveStayTimes(id, body.data));
}
