import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { CardSkeleton, StatTilesSkeleton } from "@/components/skeletons";
import { getFormat } from "@/i18n/get-format";
import { todayUtc } from "@/lib/bookings/list-params";
import { dashboardState } from "@/lib/dashboard/params";
import { listProperties } from "@/lib/properties/service";

import { DashboardFilters } from "./dashboard-filters";
import { ExpenseChart } from "./expense-chart";
import { ExportMenu } from "./export-menu";
import { Kpis } from "./kpis";
import { OccupancySection } from "./occupancy-section";
import { RevenueChart } from "./revenue-chart";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

/**
 * How the properties are doing over a range (`?preset=`, or `?from=&until=`
 * with both days included; the current month by default), for one property
 * or all (`?propertyId=`), compared with the same dates a year earlier.
 */
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const today = todayUtc();
  const state = dashboardState(await searchParams, today);
  const properties = await listProperties();
  const t = await getTranslations("dashboard");
  const range = (await getFormat()).dateRange(state.from, state.until);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={
          state.propertyId
            ? t("descriptionFor", {
                range,
                property:
                  properties.find((p) => p.id === state.propertyId)?.name ?? t("oneProperty"),
              })
            : t("description", { range })
        }
        actions={<ExportMenu from={state.from} until={state.until} propertyId={state.propertyId} />}
      />
      <DashboardFilters
        state={state}
        properties={properties.map((p) => ({ id: p.id, name: p.name }))}
      >
        {/*
         * Not keyed by the filters: a filter change is a transition, so each
         * widget keeps its figures until the new ones are ready and they all
         * update together. The skeletons show on the first load only.
         */}
        <div className="space-y-6">
          <Suspense fallback={<StatTilesSkeleton />}>
            <Kpis state={state} today={today} />
          </Suspense>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Suspense fallback={<CardSkeleton lines={8} />}>
              <RevenueChart state={state} />
            </Suspense>
            <Suspense fallback={<CardSkeleton lines={6} />}>
              <ExpenseChart state={state} />
            </Suspense>
          </div>
          <Suspense fallback={<CardSkeleton lines={8} />}>
            <OccupancySection state={state} />
          </Suspense>
        </div>
      </DashboardFilters>
    </>
  );
}
