import { apiError, fieldError, notFound } from "@/lib/api";

import { toDto, type WriteResult } from "./service";

/** Turns a booking write's outcome into the HTTP response. */
export function writeResponse(result: WriteResult, created = false): Response {
  if ("booking" in result) {
    const body = toDto(result.booking);
    return created
      ? Response.json(body, {
          status: 201,
          headers: { Location: `/api/bookings/${result.booking.id}` },
        })
      : Response.json(body);
  }
  switch (result.error) {
    case "not_found":
      return notFound("Booking");
    case "invalid":
      return fieldError(result.field, result.message);
    case "conflict": {
      const first = result.conflicts[0];
      const what = !first
        ? "Those dates are no longer available."
        : first.kind === "booking"
          ? `Those dates overlap booking ${first.id} (${first.start} to ${first.end}).`
          : `Those dates overlap a block (${first.start} to ${first.end}${first.reason ? `: ${first.reason}` : ""}).`;
      return apiError(409, "conflict", what, undefined, { conflicts: result.conflicts });
    }
  }
}
