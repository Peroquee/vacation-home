import { isUuid, notFound } from "@/lib/api";
import { resumeRecurringExpense, toDto } from "@/lib/finance/recurring";

/**
 * Resumes the rule. Periods that fell due while it was paused are skipped;
 * one due today is created at once.
 */
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/recurring-expenses/[id]/resume">,
) {
  const { id } = await params;
  const rule = isUuid(id) ? await resumeRecurringExpense(id) : null;
  return rule ? Response.json(toDto(rule)) : notFound("Recurring expense");
}
