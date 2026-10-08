import { z } from "zod";

import { fieldError, isUuid, notFound, parseBody } from "@/lib/api";
import { purgeGuest } from "@/lib/guests/purge";
import { toDto } from "@/lib/guests/service";
import { getCurrentUser } from "@/lib/session";

const confirmation = z.strictObject({ confirm: z.string() });

/**
 * Permanently erases a guest's personal data (DSGVO Art. 17); see
 * src/lib/guests/purge.ts for exactly what that covers. It cannot be
 * undone, so the body must repeat the guest's id: `{ "confirm": "<id>" }`.
 *
 * 200 `{ outcome: "anonymised", guest }` for a guest with bookings,
 * `{ outcome: "deleted" }` for one without, and `{ outcome: "already_purged",
 * guest }` when repeated.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/guests/[id]/purge">) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Guest");

  const body = await parseBody(request, confirmation);
  if ("response" in body) return body.response;
  if (body.data.confirm !== id) {
    return fieldError("confirm", "must repeat the guest's id to confirm the erasure");
  }

  const user = await getCurrentUser();
  const result = await purgeGuest(id, user?.id ?? null);
  switch (result.outcome) {
    case "not_found":
      return notFound("Guest");
    case "deleted":
      return Response.json({ outcome: "deleted" });
    case "anonymised":
    case "already_purged":
      return Response.json({ outcome: result.outcome, guest: toDto(result.guest) });
  }
}
