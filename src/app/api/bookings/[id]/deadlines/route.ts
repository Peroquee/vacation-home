import { isUuid, notFound, parseBody } from "@/lib/api";
import { changeDeadlines } from "@/lib/bookings/hold";
import { writeResponse } from "@/lib/bookings/responses";
import { deadlinesSchema } from "@/lib/payment-terms/schema";

/**
 * Moves a reserved booking's payment deadlines by hand (GitLab #114):
 * `depositDueOn` while reserved, `balanceDueOn` while the balance is still
 * to pay, as YYYY-MM-DD in the property's timezone.
 */
export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/bookings/[id]/deadlines">,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Booking");
  const body = await parseBody(request, deadlinesSchema);
  if ("response" in body) return body.response;
  return writeResponse(await changeDeadlines(id, body.data));
}
