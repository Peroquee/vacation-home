import { apiError, validationError } from "@/lib/api";
import { exportSchema, exportTransactions, MAX_EXPORT_ROWS } from "@/lib/finance/export";
import { queryParams } from "@/lib/query";

/**
 * The ledger's transactions as CSV (GitLab #83), with the ledger's filters:
 * `propertyId`, `type`, `categoryId`, `from`, `to`, `receipts` (`none` or
 * `some`), and `format`
 * (`standard` or `excel-de`). Columns: src/lib/finance/csv.ts.
 */
export async function GET(request: Request) {
  const parsed = exportSchema.safeParse(queryParams(request));
  if (!parsed.success) return validationError(parsed.error);
  const result = await exportTransactions(parsed.data);
  if ("tooMany" in result) {
    return apiError(
      422,
      "validation_failed",
      `At most ${MAX_EXPORT_ROWS} transactions per file; choose a shorter range.`,
    );
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transactions-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
