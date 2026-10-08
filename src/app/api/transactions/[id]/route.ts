import { isUuid, notFound, parseBody } from "@/lib/api";
import { transactionResponse } from "@/lib/finance/responses";
import {
  deleteTransaction,
  getTransaction,
  toDto,
  updateTransaction,
  updateTransactionSchema,
} from "@/lib/finance/transactions";

type Context = RouteContext<"/api/transactions/[id]">;

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const transaction = isUuid(id) ? await getTransaction(id) : null;
  return transaction ? Response.json(toDto(transaction)) : notFound("Transaction");
}

/** Updates any subset of fields; a new type needs a category of that type. */
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Transaction");
  const body = await parseBody(request, updateTransactionSchema);
  if ("response" in body) return body.response;
  return transactionResponse(await updateTransaction(id, body.data));
}

export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  const deleted = isUuid(id) && (await deleteTransaction(id));
  return deleted ? new Response(null, { status: 204 }) : notFound("Transaction");
}
