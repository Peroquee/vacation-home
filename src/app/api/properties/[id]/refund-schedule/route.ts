import { isUuid, notFound, parseBody } from "@/lib/api";
import { refundScheduleBodySchema } from "@/lib/payment-terms/schema";
import { getPaymentTerms, saveRefundSchedule } from "@/lib/payment-terms/service";
import { getProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/properties/[id]/refund-schedule">;

/**
 * When a cancelling guest's deposit is kept, and how much (GitLab #123):
 * `{ schedule }`, null for "all of it" (#116).
 */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id) || !(await getProperty(id))) return notFound("Property");
  return Response.json({ schedule: (await getPaymentTerms(id)).refundSchedule });
}

/**
 * Replaces it, or removes it with `{ schedule: null }`. 422 for a share
 * above 100 or a start above the end, more than 24 months, or a ramp longer
 * than the free window or without one. Bookings keep the schedule they were
 * requested under.
 */
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const body = await parseBody(request, refundScheduleBodySchema);
  if ("response" in body) return body.response;
  if (!(await getProperty(id))) return notFound("Property");
  const terms = await saveRefundSchedule(id, body.data.schedule);
  return Response.json({ schedule: terms.refundSchedule });
}
