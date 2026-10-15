import { isUuid, notFound, parseBody } from "@/lib/api";
import { writeResponse } from "@/lib/bookings/responses";
import { toDto } from "@/lib/bookings/service";
import { db } from "@/lib/db";
import { paymentSchema } from "@/lib/payments/schema";
import { listPayments, recordPayment } from "@/lib/payments/service";

type Context = RouteContext<"/api/bookings/[id]/payments">;

/** The booking's payments and refunds (GitLab #115), oldest first. */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id) || !(await db.booking.findUnique({ where: { id }, select: { id: true } }))) {
    return notFound("Booking");
  }
  return Response.json(await listPayments(id));
}

/**
 * Records money received (`deposit`, `balance`, `full`, `other`) or paid
 * back (`refund`). 201 with the payment and the booking as it now is: a
 * reservation whose first payment is in is confirmed, a booking whose total
 * is in is paid.
 */
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Booking");
  const body = await parseBody(request, paymentSchema);
  if ("response" in body) return body.response;
  const result = await recordPayment(id, body.data);
  if (!("payment" in result)) return writeResponse(result);
  return Response.json(
    { payment: result.payment, booking: toDto(result.booking) },
    { status: 201 },
  );
}
