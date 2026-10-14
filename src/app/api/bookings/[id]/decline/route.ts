import { z } from "zod";

import { isUuid, notFound, parseBody } from "@/lib/api";
import { declineRequest, REASON_MAX } from "@/lib/booking-requests/inbox";
import { writeResponse } from "@/lib/bookings/responses";

const declineSchema = z.strictObject({
  reason: z
    .string()
    .trim()
    .max(REASON_MAX, `must be at most ${REASON_MAX} characters`)
    .nullable()
    .optional()
    .transform((value) => value || null),
});

/**
 * Declines a request (GitLab #110): inquiry -> cancelled, with an optional
 * `reason` the guest is told. 422 for anything but an inquiry.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/bookings/[id]/decline">,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Booking");
  const body = await parseBody(request, declineSchema);
  if ("response" in body) return body.response;
  return writeResponse(await declineRequest(id, body.data.reason));
}
