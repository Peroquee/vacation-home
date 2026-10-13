import { env } from "@/env";
import { isUuid, notFound } from "@/lib/api";
import { db } from "@/lib/db";
import { guestPath, issueGuestToken } from "@/lib/payments/guest-link";

type Context = RouteContext<"/api/bookings/[id]/guest-link">;

/**
 * A new link for the guest to see their booking (GitLab #115): status,
 * what to pay and by when, the bank details and GiroCode. Shown to the
 * owner once, to pass on; only its hash is kept.
 */
export async function POST(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id) || !(await db.booking.findUnique({ where: { id }, select: { id: true } }))) {
    return notFound("Booking");
  }
  const token = await issueGuestToken(id);
  return Response.json(
    { url: new URL(guestPath(token), env.APP_URL).toString() },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
