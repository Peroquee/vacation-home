import { parseBody, validationError } from "@/lib/api";
import { queryParams } from "@/lib/query";
import { transactionResponse } from "@/lib/finance/responses";
import {
  createTransaction,
  createTransactionSchema,
  listTransactions,
  listTransactionsSchema,
  toDto,
} from "@/lib/finance/transactions";

/**
 * The ledger, a page at a time. Filters: `propertyId`, `type`, `categoryId`
 * (comma-separated), `from`/`to` (dates, `to` exclusive), `bookingId` or
 * `linked=true|false`; `page`, `pageSize` (at most 200) and `sort` (`date`,
 * `-date`, `amount`, `-amount`). `totals` sums every matching transaction,
 * one entry per currency. A repeated parameter counts like a comma list.
 */
export async function GET(request: Request) {
  const parsed = listTransactionsSchema.safeParse(queryParams(request));
  if (!parsed.success) return validationError(parsed.error);
  const { items, ...rest } = await listTransactions(parsed.data);
  return Response.json({ items: items.map(toDto), ...rest });
}

/** Records a transaction in the property's currency. */
export async function POST(request: Request) {
  const body = await parseBody(request, createTransactionSchema);
  if ("response" in body) return body.response;
  return transactionResponse(await createTransaction(body.data), true);
}
