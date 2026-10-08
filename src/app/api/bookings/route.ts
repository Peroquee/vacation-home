import { parseBody, validationError } from "@/lib/api";
import { writeResponse } from "@/lib/bookings/responses";
import { createBookingSchema, listBookingsSchema } from "@/lib/bookings/schema";
import { createBooking, listBookings, toDto } from "@/lib/bookings/service";

/**
 * Lists bookings, a page at a time. Filters: `propertyId`, `from`/`to` (stays
 * overlapping that range), `status` and `source` (comma-separated), `q` (part
 * of the guest's name or email); `page`, `pageSize` (at most 100) and `sort`
 * (`checkIn` or `-checkIn`).
 */
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = listBookingsSchema.safeParse(params);
  if (!parsed.success) return validationError(parsed.error);

  const { items, ...page } = await listBookings(parsed.data);
  return Response.json({ items: items.map(toDto), ...page });
}

/**
 * Creates a booking. Rates default to the property's and the total is
 * calculated unless given. A confirmed booking whose dates are taken is
 * refused with a 409 naming what is in the way.
 */
export async function POST(request: Request) {
  const body = await parseBody(request, createBookingSchema);
  if ("response" in body) return body.response;
  return writeResponse(await createBooking(body.data), true);
}
