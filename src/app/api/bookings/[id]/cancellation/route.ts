import { isUuid, notFound } from "@/lib/api";
import { cancellationPreview } from "@/lib/cancellation/preview";

/**
 * What cancelling the booking would pay back (GitLab #116): the
 * policy it is under, what was received, the guest's refund under it
 * (all but a non-refundable deposit) and the owner's (all of it).
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/bookings/[id]/cancellation">,
) {
  const { id } = await params;
  const preview = isUuid(id) ? await cancellationPreview(id) : null;
  return preview ? Response.json(preview) : notFound("Booking");
}
