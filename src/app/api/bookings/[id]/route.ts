import { isUuid, notFound, parseBody } from "@/lib/api";
import { writeResponse } from "@/lib/bookings/responses";
import { updateBookingSchema } from "@/lib/bookings/schema";
import { getBooking, toDto, updateBooking } from "@/lib/bookings/service";

type Context = RouteContext<"/api/bookings/[id]">;

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const booking = isUuid(id) ? await getBooking(id) : null;
  return booking ? Response.json(toDto(booking)) : notFound("Booking");
}

/**
 * Updates any subset of fields. New dates, or confirming, re-run the
 * availability check, ignoring this booking itself; 409 if taken.
 */
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Booking");

  const body = await parseBody(request, updateBookingSchema);
  if ("response" in body) return body.response;
  return writeResponse(await updateBooking(id, body.data));
}
