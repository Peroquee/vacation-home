import { calendarConnectAvailable, disconnect, getConnectionStatus } from "@/lib/google/connection";
import { getCurrentUser } from "@/lib/session";

/**
 * The signed-in user's Google Calendar connection:
 *
 *   { available, status: "not_connected" | "connected" | "disconnected",
 *     googleEmail?, connectedAt?, reason? }
 *
 * `available: false` means connecting is switched off (no
 * TOKEN_ENCRYPTION_KEY). `disconnected` with `reason: "revoked"` means
 * Google no longer honours the grant: show a "reconnect" prompt, linking to
 * /api/google/connect.
 */
export async function GET() {
  const user = await getCurrentUser();
  const status = user ? await getConnectionStatus(user.id) : { status: "not_connected" as const };
  return Response.json({ available: calendarConnectAvailable(), ...status });
}

/** Disconnects: revokes the grant at Google and forgets it. 204, also when not connected. */
export async function DELETE() {
  const user = await getCurrentUser();
  if (user) await disconnect(user.id);
  return new Response(null, { status: 204 });
}
