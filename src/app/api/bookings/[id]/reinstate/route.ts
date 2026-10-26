import { isUuid, notFound } from "@/lib/api";
import { writeResponse } from "@/lib/bookings/responses";
import { reinstateBooking } from "@/lib/bookings/service";

/**
 * Brings a cancelled or expired booking back as a request (GitLab #135),
 * without its cancellation, expiry or hold. 409 with the conflicts when its
 * dates have been taken meanwhile; 422 while money is held, or for a booking
 * that is neither cancelled nor expired.
 */
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/bookings/[id]/reinstate">,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Booking");
  return writeResponse(await reinstateBooking(id));
}
