import { parseBody, validationError } from "@/lib/api";
import {
  createRecurringExpense,
  createRecurringExpenseSchema,
  listRecurringExpenses,
  listRecurringExpensesSchema,
  toDto,
} from "@/lib/finance/recurring";
import { ruleResponse } from "@/lib/finance/recurring-responses";
import { queryParams } from "@/lib/query";

/** Recurring expense rules, oldest first, each with its `status` and `nextDueDate`. Filter: `propertyId`. */
export async function GET(request: Request) {
  const parsed = listRecurringExpensesSchema.safeParse(queryParams(request));
  if (!parsed.success) return validationError(parsed.error);
  return Response.json((await listRecurringExpenses(parsed.data)).map(toDto));
}

/**
 * Creates a rule. Periods already due (a start date today or in the past)
 * are created at once; later ones by the hourly job.
 */
export async function POST(request: Request) {
  const body = await parseBody(request, createRecurringExpenseSchema);
  if ("response" in body) return body.response;
  return ruleResponse(await createRecurringExpense(body.data), true);
}
