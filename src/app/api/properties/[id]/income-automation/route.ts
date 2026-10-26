import { z } from "zod";

import { isUuid, notFound, parseBody } from "@/lib/api";
import { getIncomeAutomation, setIncomeAutomation } from "@/lib/finance/income-automation";

type Context = RouteContext<"/api/properties/[id]/income-automation">;

const settingsSchema = z.strictObject({
  enabled: z.boolean(),
  /** What happens to generated entries when the booking is cancelled. */
  onCancel: z.enum(["delete", "zero"]).default("delete"),
});

/**
 * Whether confirmed bookings of the property create their income entries:
 * `{ enabled, onCancel: "delete" | "zero" }`. On for a new property.
 */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const settings = await getIncomeAutomation(id);
  if (!settings) return notFound("Property");
  return Response.json(settings);
}

/**
 * Turns income automation on or off (GitLab #137). On, the bookings already
 * confirmed get their entries too, unless hand-typed income is linked to
 * them; off, the generated entries nobody edited go. Answers the settings
 * with `added` and `removed`, the entries created and taken out.
 */
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const body = await parseBody(request, settingsSchema);
  if ("response" in body) return body.response;
  const result = await setIncomeAutomation(id, body.data);
  if (!result) return notFound("Property");
  return Response.json(result);
}
