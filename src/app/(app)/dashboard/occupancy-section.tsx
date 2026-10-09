import { getTranslations } from "next-intl/server";

import { OccupancyChart } from "@/components/charts/occupancy-chart";
import { OccupancyHeatmap } from "@/components/charts/occupancy-heatmap";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { priorRange } from "@/lib/analytics/rules";
import { getCalendars } from "@/lib/availability/calendar";
import { addDays } from "@/lib/calendar-date";
import { heatmap, heatmapWindow, monthlyOccupancy, withPriorYear } from "@/lib/dashboard/occupancy";
import type { DashboardState } from "@/lib/dashboard/params";
import { listProperties } from "@/lib/properties/service";

import { loadReport } from "./data";

/** The availability service lays out at most this many properties at once. */
const MAX_PROPERTIES = 20;

/**
 * Occupancy for the dashboard's filters: per month, optionally beside the
 * same months a year earlier, and a year of booked nights as a heatmap. The
 * definition is stated, since whether blocked nights count changes the rate.
 */
export async function OccupancySection({ state }: { state: DashboardState }) {
  const year = priorRange({ start: state.from, end: addDays(state.until, 1) }, "year");
  const window = heatmapWindow(state.until);
  const ids = state.propertyId
    ? [state.propertyId]
    : (await listProperties()).slice(0, MAX_PROPERTIES).map((p) => p.id);

  const [current, prior, { calendars }] = await Promise.all([
    loadReport(state),
    loadReport({ ...state, from: year.start, until: addDays(year.end, -1) }),
    getCalendars(ids, window),
  ]);
  if (!current.ok || !("report" in current.result)) return null;
  const t = await getTranslations("dashboard.occupancy");
  const months = withPriorYear(
    monthlyOccupancy(current.result.report.months),
    prior.ok && "report" in prior.result ? monthlyOccupancy(prior.result.report.months) : null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-8 lg:grid-cols-2">
        <OccupancyChart months={months} />
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t("heatmapTitle")}</h3>
          <OccupancyHeatmap
            months={heatmap(window, calendars)}
            properties={Math.max(1, calendars.length)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
