import { isUuid, notFound } from "@/lib/api";
import { pauseRecurringExpense, toDto } from "@/lib/finance/recurring";

/** Pauses the rule: nothing more is created until resumed. Past transactions stay. */
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/recurring-expenses/[id]/pause">,
) {
  const { id } = await params;
  const rule = isUuid(id) ? await pauseRecurringExpense(id) : null;
  return rule ? Response.json(toDto(rule)) : notFound("Recurring expense");
}
