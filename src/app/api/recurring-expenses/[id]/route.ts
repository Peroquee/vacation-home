import { isUuid, notFound, parseBody } from "@/lib/api";
import {
  deleteRecurringExpense,
  getRecurringExpense,
  toDto,
  updateRecurringExpense,
  updateRecurringExpenseSchema,
} from "@/lib/finance/recurring";
import { ruleResponse } from "@/lib/finance/recurring-responses";

type Context = RouteContext<"/api/recurring-expenses/[id]">;

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const rule = isUuid(id) ? await getRecurringExpense(id) : null;
  return rule ? Response.json(toDto(rule)) : notFound("Recurring expense");
}

/** Changes the amount, category, end date or description of periods not created yet. */
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Recurring expense");
  const body = await parseBody(request, updateRecurringExpenseSchema);
  if ("response" in body) return body.response;
  return ruleResponse(await updateRecurringExpense(id, body.data));
}

/** Deletes the rule (204). The transactions it created stay. */
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  const deleted = isUuid(id) && (await deleteRecurringExpense(id));
  return deleted ? new Response(null, { status: 204 }) : notFound("Recurring expense");
}
