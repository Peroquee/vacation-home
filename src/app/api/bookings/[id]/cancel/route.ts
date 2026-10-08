import { isUuid, notFound } from "@/lib/api";
import { cancelBooking, toDto } from "@/lib/bookings/service";

/**
 * Cancels a booking: its dates are freed, the record is kept. Bookings are
 * never deleted - they are accounting records. Idempotent.
 */
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/bookings/[id]/cancel">,
) {
  const { id } = await params;
  const booking = isUuid(id) ? await cancelBooking(id) : null;
  return booking ? Response.json(toDto(booking)) : notFound("Booking");
}
