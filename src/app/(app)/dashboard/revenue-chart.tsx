import { getTranslations } from "next-intl/server";

import { RevenueExpensesChart } from "@/components/charts/revenue-expenses-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardState } from "@/lib/dashboard/params";

import { loadReport } from "./data";

/**
 * Income, expenses and net per month for the dashboard's filters. Shares the
 * KPI row's report; nothing to show (mixed currencies, broken filters) is
 * left to the KPI row to explain.
 */
export async function RevenueChart({ state }: { state: DashboardState }) {
  const loaded = await loadReport(state);
  if (!loaded.ok || !("report" in loaded.result)) return null;
  const { report } = loaded.result;
  const currency = report.currency;
  if (!currency) return null;
  const t = await getTranslations("dashboard.revenue");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description", { currency })}</CardDescription>
      </CardHeader>
      <CardContent>
        <RevenueExpensesChart
          currency={currency}
          months={report.months.map((m) => ({
            month: m.month,
            incomeMinor: m.incomeMinor,
            expensesMinor: m.expensesMinor,
            netMinor: m.netMinor,
          }))}
        />
      </CardContent>
    </Card>
  );
}
