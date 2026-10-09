import type { Metadata } from "next";
import Form from "next/form";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { CardSkeleton, StatTilesSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { todayUtc } from "@/lib/bookings/list-params";
import { dashboardState } from "@/lib/dashboard/params";
import { formatDateRange } from "@/lib/format";
import { listProperties } from "@/lib/properties/service";

import { ExpenseChart } from "./expense-chart";
import { Kpis } from "./kpis";
import { RevenueChart } from "./revenue-chart";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * How the properties are doing over a range (`?from=&until=`, both days
 * included; the current month by default), for one property or all
 * (`?propertyId=`), compared with the same dates a year earlier.
 */
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const today = todayUtc();
  const state = dashboardState(await searchParams, today);
  const properties = await listProperties();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${formatDateRange(state.from, state.until)}${
          state.propertyId
            ? `, ${properties.find((p) => p.id === state.propertyId)?.name ?? "one property"}`
            : ", all properties"
        }`}
      />
      <Form
        action="/dashboard"
        className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,12rem))_auto] lg:items-end"
      >
        <Field>
          <FieldLabel htmlFor="dashboard-from">From</FieldLabel>
          <Input id="dashboard-from" name="from" type="date" defaultValue={state.from} />
        </Field>
        <Field>
          <FieldLabel htmlFor="dashboard-until">Until</FieldLabel>
          <Input id="dashboard-until" name="until" type="date" defaultValue={state.until} />
        </Field>
        <Field>
          <FieldLabel htmlFor="dashboard-property">Property</FieldLabel>
          <NativeSelect
            id="dashboard-property"
            name="propertyId"
            className="w-full"
            defaultValue={state.propertyId ?? ""}
          >
            <NativeSelectOption value="">All properties</NativeSelectOption>
            {properties.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Button type="submit">Show</Button>
      </Form>

      {/* Keyed by the filters, so a new range shows the skeleton again. */}
      <div className="space-y-6">
        <Suspense key={JSON.stringify(state)} fallback={<StatTilesSkeleton />}>
          <Kpis state={state} today={today} />
        </Suspense>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Suspense key={`chart-${JSON.stringify(state)}`} fallback={<CardSkeleton lines={8} />}>
            <RevenueChart state={state} />
          </Suspense>
          <Suspense key={`expenses-${JSON.stringify(state)}`} fallback={<CardSkeleton lines={6} />}>
            <ExpenseChart state={state} />
          </Suspense>
        </div>
      </div>
    </>
  );
}
