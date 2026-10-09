import { z } from "zod";

import { parseBody } from "@/lib/api";
import { retry } from "@/lib/google/sync-status";
import { kickOutboundSync } from "@/lib/google/sync-worker";
import { getCurrentUser } from "@/lib/session";

const body = z.strictObject({ linkId: z.uuid("must be a link id").optional() });

/**
 * Retries failing events now - `{ linkId }` for one (from the failures
 * list), `{}` for all of the user's. Answers `{ queued }`.
 */
export async function POST(request: Request) {
  const parsed = await parseBody(request, body);
  if ("response" in parsed) return parsed.response;
  const user = await getCurrentUser();
  const queued = user ? await retry(user.id, parsed.data.linkId) : 0;
  kickOutboundSync();
  return Response.json({ queued });
}
