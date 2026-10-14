import { isUuid, notFound, parseBody } from "@/lib/api";
import {
  getRequestSettings,
  requestSettingsSchema,
  saveRequestSettings,
} from "@/lib/booking-requests/settings";
import { getProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/properties/[id]/request-settings">;

/**
 * How the property's booking requests are handled (GitLab #110):
 * `expiryDays` an unanswered request waits, `retentionMonths` declined and
 * expired ones are kept before they are anonymised.
 */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id) || !(await getProperty(id))) return notFound("Property");
  return Response.json(await getRequestSettings(id));
}

/** Replaces the settings; both fields are required. */
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const body = await parseBody(request, requestSettingsSchema);
  if ("response" in body) return body.response;
  if (!(await getProperty(id))) return notFound("Property");
  return Response.json(await saveRequestSettings(id, body.data));
}
