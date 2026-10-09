import { recentFailures } from "@/lib/google/sync-status";
import { getCurrentUser } from "@/lib/session";

/** The signed-in user's failing booking events, most recent first (up to 50), for the settings panel. */
export async function GET() {
  const user = await getCurrentUser();
  return Response.json(user ? await recentFailures(user.id) : []);
}
