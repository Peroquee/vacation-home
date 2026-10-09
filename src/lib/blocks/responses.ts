import { apiError, fieldError, notFound } from "@/lib/api";

import { type BlockWriteResult, toDto } from "./writes";

/** 409 for a block from Google Calendar, which only the sync may change. */
export function readOnlyBlock(origin: "google" | "ical"): Response {
  return apiError(
    409,
    "conflict",
    origin === "google"
      ? "This block comes from Google Calendar. Change or delete the event there; the sync updates the block."
      : "This block comes from a booking platform's calendar. Change the stay on the platform; the feed updates the block.",
    undefined,
    { reason: origin },
  );
}

/** Turns a block write's outcome into the HTTP response. */
export function blockWriteResponse(result: BlockWriteResult, created = false): Response {
  if ("block" in result) {
    const body = toDto(result.block);
    return created
      ? Response.json(body, {
          status: 201,
          headers: { Location: `/api/blocks/${result.block.id}` },
        })
      : Response.json(body);
  }
  switch (result.error) {
    case "not_found":
      return notFound("Block");
    case "read_only":
      return readOnlyBlock(result.origin);
    case "invalid":
      return fieldError(result.field, result.message);
    case "conflict": {
      const first = result.conflicts[0];
      const what = first
        ? `Those dates overlap booking ${first.id} (${first.start} to ${first.end}).`
        : "Those dates overlap a confirmed booking.";
      return apiError(409, "conflict", what, undefined, {
        reason: "overlap",
        conflicts: result.conflicts,
      });
    }
  }
}
