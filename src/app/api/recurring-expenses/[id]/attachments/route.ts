import { isUuid, notFound } from "@/lib/api";
import { listResponse, uploadResponse } from "@/lib/finance/receipt-route";

type Context = RouteContext<"/api/recurring-expenses/[id]/attachments">;

/**
 * A recurring cost's documents (GitLab #130): its contract, yearly
 * statements, invoices. Downloaded and removed through /api/attachments/:id,
 * like a transaction's receipts.
 */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Recurring expense");
  return listResponse({ recurringExpenseId: id });
}

/**
 * Adds a document: multipart form data with `file` (and an optional
 * `thumbnail` for images), checked like a receipt. 201 with it; 422 for a
 * file of the wrong type or size, or a 21st one.
 */
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Recurring expense");
  return uploadResponse(request, { recurringExpenseId: id });
}
