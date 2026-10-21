import { isUuid, notFound } from "@/lib/api";
import { listRulePayments } from "@/lib/finance/recurring";

type Context = RouteContext<"/api/recurring-expenses/[id]/payments">;

/**
 * The transactions the rule made, newest first, with their receipt counts
 * (GitLab #130): `{ items, total }`, at most the latest 24.
 */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const payments = isUuid(id) ? await listRulePayments(id) : null;
  return payments ? Response.json(payments) : notFound("Recurring expense");
}
