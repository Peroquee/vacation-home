import { parseBody } from "@/lib/api";
import { bulkDeleteSchema, deleteTransactions } from "@/lib/finance/transactions";

/**
 * Deletes up to 500 transactions at once, for cleaning up import mistakes:
 * `{ "ids": [...] }`. Ids that do not exist are ignored; `deleted` counts
 * the rest.
 */
export async function POST(request: Request) {
  const body = await parseBody(request, bulkDeleteSchema);
  if ("response" in body) return body.response;
  return Response.json({ deleted: await deleteTransactions(body.data.ids) });
}
