import { ExpenseBreakdown } from "@/components/charts/expense-breakdown";
import { EmptyState } from "@/components/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { breakdownRows } from "@/lib/dashboard/breakdown";
import type { DashboardState } from "@/lib/dashboard/params";

import { loadReport } from "./data";

/**
 * Expenses by category for the dashboard's filters; a category leads to the
 * ledger filtered to it, its period and property. Shares the KPI row's report.
 */
export async function ExpenseChart({ state }: { state: DashboardState }) {
  const loaded = await loadReport(state);
  if (!loaded.ok || !("report" in loaded.result)) return null;
  const { report } = loaded.result;
  const currency = report.currency;
  if (!currency) return null;
  const rows = breakdownRows(report.expensesByCategory);

  const ledger = (categoryId: string) => {
    const params = new URLSearchParams({
      type: "expense",
      categoryId,
      from: state.from,
      until: state.until,
      ...(state.propertyId && { propertyId: state.propertyId }),
    });
    return `/finance?${params}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where the money goes</CardTitle>
        <CardDescription>Expenses by category, in {currency}.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState title="No expenses in this period" />
        ) : (
          <ExpenseBreakdown rows={rows} currency={currency} categoryHref={ledger} />
        )}
      </CardContent>
    </Card>
  );
}
