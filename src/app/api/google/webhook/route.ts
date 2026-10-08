import { apiError } from "@/lib/api";
import { acceptNotification } from "@/lib/google/inbound";
import { kickInboundPoll } from "@/lib/google/inbound-worker";

/**
 * Google Calendar push notifications (only used when GOOGLE_WEBHOOK_URL is
 * set; see src/lib/google/inbound.ts). Public - Google has no session - so
 * each call must name a channel this app created and carry its secret
 * token and resource id; anything else is refused with 401. A genuine
 * notification has no body and only makes the calendar's next poll happen
 * now.
 */
export async function POST(request: Request) {
  const header = (name: string) => request.headers.get(name);
  const genuine = await acceptNotification({
    channelId: header("x-goog-channel-id"),
    token: header("x-goog-channel-token"),
    resourceId: header("x-goog-resource-id"),
    state: header("x-goog-resource-state"),
  });
  if (!genuine)
    return apiError(401, "unauthorized", "Not a notification for a channel of this app.");
  kickInboundPoll();
  return new Response(null, { status: 204 });
}
