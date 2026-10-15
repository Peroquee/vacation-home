import { isUuid, notFound } from "@/lib/api";
import { deletePayment } from "@/lib/payments/service";

type Context = RouteContext<"/api/bookings/[id]/payments/[paymentId]">;

/**
 * Takes back a payment recorded by mistake, with its ledger entry. The
 * booking's status stays: change it by hand if need be.
 */
export async function DELETE(_request: Request, { params }: Context) {
  const { id, paymentId } = await params;
  if (!isUuid(id) || !isUuid(paymentId) || !(await deletePayment(id, paymentId))) {
    return notFound("Payment");
  }
  return new Response(null, { status: 204 });
}
