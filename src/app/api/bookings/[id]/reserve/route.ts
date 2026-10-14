import { isUuid, notFound } from "@/lib/api";
import { reserveBooking } from "@/lib/bookings/hold";
import { writeResponse } from "@/lib/bookings/responses";

/**
 * Accepts a request (GitLab #114): inquiry -> reserved, its dates held until
 * the first payment's deadline under the property's payment terms. 409 with
 * the conflicts when the dates were taken meanwhile; 422 for a booking that
 * is not an inquiry.
 */
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/bookings/[id]/reserve">,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Booking");
  return writeResponse(await reserveBooking(id));
}
