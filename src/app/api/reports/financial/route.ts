import { apiError, notFound } from "@/lib/api";
import { buildReportContent } from "@/app/(app)/dashboard/report";
import { appToday } from "@/lib/app-today";
import { dashboardState } from "@/lib/dashboard/params";
import { db } from "@/lib/db";
import { queryParams } from "@/lib/query";
import { renderFinancialReport } from "@/lib/reports/financial-pdf";

/**
 * The financial report as a PDF (GitLab #90), for the dashboard's filters:
 * `preset`, or `from` and `until` (both included), and `propertyId`. The
 * figures are the dashboard's for the same filters.
 */
export async function GET(request: Request) {
  const today = appToday();
  const state = dashboardState(queryParams(request), today);
  const property = state.propertyId
    ? await db.property.findUnique({ where: { id: state.propertyId }, select: { name: true } })
    : null;
  if (state.propertyId && !property) return notFound("Property");

  const outcome = await buildReportContent(state, today, property?.name ?? null);
  if (outcome.kind === "invalid") {
    return apiError(422, "validation_failed", "The request has invalid fields.");
  }
  if (outcome.kind === "mixed_currencies") {
    return apiError(
      409,
      "conflict",
      "These properties use different currencies; choose one property.",
      undefined,
      { reason: "mixed_currencies", currencies: outcome.currencies },
    );
  }
  if (outcome.kind === "not_found") return notFound("Property");

  const pdf = await renderFinancialReport(outcome.content);
  const name = `report-${state.from}-${state.until}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
