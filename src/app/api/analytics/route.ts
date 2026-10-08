import { apiError, notFound, validationError } from "@/lib/api";
import { analyticsQuerySchema, getAnalytics } from "@/lib/analytics/service";
import { queryParams } from "@/lib/query";

/**
 * Financial and occupancy figures for a range: `from`, `to` (half-open, at
 * most three years), `propertyId` (default: all properties), `compare`
 * (`year`, the default, or `previous`) and `excludeBlocks` (default true).
 * See src/lib/analytics/rules.ts for how each figure is defined.
 */
export async function GET(request: Request) {
  const parsed = analyticsQuerySchema.safeParse(queryParams(request));
  if (!parsed.success) return validationError(parsed.error);

  const result = await getAnalytics(parsed.data);
  if ("report" in result) return Response.json(result.report);
  if (result.error === "not_found") return notFound("Property");
  return apiError(
    409,
    "conflict",
    "These properties use different currencies; choose one property.",
    undefined,
    { reason: "mixed_currencies", currencies: result.currencies },
  );
}
