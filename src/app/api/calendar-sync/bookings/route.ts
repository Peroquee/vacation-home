import { validationError } from "@/lib/api";
import { bookingIdsSchema, bookingSyncStatus } from "@/lib/google/sync-status";
import { queryParams } from "@/lib/query";

/**
 * Sync badges for bookings: `?ids=a,b,c` (up to 200) answers
 * `{ [bookingId]: { state, lastSyncedAt, error } }`, where `state` is
 * `synced`, `pending`, `failed`, `dead` (given up on; retry by hand) or
 * `not_synced` (no event: sync off, or not confirmed).
 */
export async function GET(request: Request) {
  const parsed = bookingIdsSchema.safeParse(queryParams(request));
  if (!parsed.success) return validationError(parsed.error);
  return Response.json(await bookingSyncStatus(parsed.data.ids));
}
