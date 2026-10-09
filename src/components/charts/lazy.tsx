"use client";

/**
 * The dashboard's charts, loaded as their own chunks (GitLab #97): Recharts
 * is the largest library on the dashboard, so it stays out of the page's
 * first-load JavaScript. The charts are still rendered on the server, so
 * nothing moves when their code arrives; until then a placeholder of the
 * same height holds their place.
 */
import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

function ChartPlaceholder() {
  return <Skeleton className="h-64 w-full" />;
}

export const RevenueExpensesChart = dynamic(
  () => import("./revenue-expenses-chart").then((m) => m.RevenueExpensesChart),
  { loading: ChartPlaceholder },
);

export const OccupancyChart = dynamic(
  () => import("./occupancy-chart").then((m) => m.OccupancyChart),
  { loading: ChartPlaceholder },
);
