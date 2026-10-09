import { cache } from "react";

import { analyticsQuerySchema, getAnalytics } from "@/lib/analytics/service";
import { analyticsQuery, type DashboardState } from "@/lib/dashboard/params";

/**
 * The analytics report for the dashboard's filters, loaded once per request
 * however many widgets ask for it: each widget streams in on its own, but
 * they share this query. Keyed by the filters as JSON, since `cache`
 * compares its arguments by identity.
 */
const load = cache(async (key: string) => {
  const query = analyticsQuerySchema.safeParse(JSON.parse(key));
  if (!query.success) return { ok: false as const, invalid: query.error };
  return { ok: true as const, result: await getAnalytics(query.data) };
});

export function loadReport(state: DashboardState) {
  return load(JSON.stringify(analyticsQuery(state)));
}
