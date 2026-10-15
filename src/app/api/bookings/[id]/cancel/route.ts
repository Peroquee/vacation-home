import { isUuid, notFound, parseBody } from "@/lib/api";
import { writeResponse } from "@/lib/bookings/responses";
import { cancelBooking } from "@/lib/bookings/service";
import { cancelSchema } from "@/lib/cancellation/schema";

/**
 * Cancels a booking (GitLab #116): its dates are freed, the record is kept.
 * Bookings are never deleted - they are accounting records. Idempotent.
 *
 * Optional body: `by` ("owner", the default, refunds everything received;
 * "guest" refunds per the booking's cancellation policy) and `refundMinor`
 * to override that refund. The refund is then due; it is recorded with the
 * payments once sent.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/bookings/[id]/cancel">,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Booking");
  let input = cancelSchema.parse({});
  if ((await request.clone().text()).trim() !== "") {
    const body = await parseBody(request, cancelSchema);
    if ("response" in body) return body.response;
    input = body.data;
  }
  return writeResponse(await cancelBooking(id, input));
}
