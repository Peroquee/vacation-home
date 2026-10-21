import { isUuid, notFound } from "@/lib/api";
import { listResponse, uploadResponse } from "@/lib/finance/receipt-route";

type Context = RouteContext<"/api/transactions/[id]/attachments">;

/** The transaction's receipts (GitLab #82). */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Transaction");
  return listResponse({ transactionId: id });
}

/**
 * Adds a receipt: multipart form data with `file`, and for images an
 * optional `thumbnail` (a small JPEG made by the browser). 201 with the
 * receipt; 422 for a file of the wrong type or size, or a sixth one.
 */
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Transaction");
  return uploadResponse(request, { transactionId: id });
}
