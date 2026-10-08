import { googleFailureResponse, writableCalendars } from "@/lib/google/calendar-settings";
import { getCurrentUser } from "@/lib/session";

/**
 * The signed-in user's Google calendars that the app can write to (owner or
 * writer access; read-only calendars are left out), for the per-property
 * calendar selector: `[{ id, summary, primary?, accessRole, timeZone? }]`.
 *
 * 409 with `reason` `not_connected`/`revoked`/`key_changed` when Google
 * Calendar is not connected; 502 when Google cannot be reached.
 */
export async function GET() {
  const user = await getCurrentUser();
  try {
    const calendars = await writableCalendars(user!.id);
    return Response.json(
      calendars.map(({ id, summary, primary, accessRole, timeZone }) => ({
        id,
        summary,
        primary: primary ?? false,
        accessRole,
        timeZone: timeZone ?? null,
      })),
    );
  } catch (error) {
    const response = googleFailureResponse(error);
    if (response) return response;
    throw error;
  }
}
