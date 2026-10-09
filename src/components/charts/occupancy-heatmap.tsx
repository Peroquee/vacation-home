import { useLocale, useTranslations } from "next-intl";

import { formattersFor } from "@/i18n/format";
import { heatStep, type HeatmapMonth } from "@/lib/dashboard/occupancy";

const STEPS = ["var(--muted)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"];

/**
 * A year of booked nights: one row per month, one cell per night, darker the
 * more properties were booked (with one property, booked is simply dark).
 * One blue ramp, light to dark: magnitude, not categories. Every cell and
 * row says its figures in words for screen readers and on hover.
 */
export function OccupancyHeatmap({
  months,
  properties,
}: {
  months: HeatmapMonth[];
  /** How many properties a night can be booked in. */
  properties: number;
}) {
  const t = useTranslations("charts.heatmap");
  const locale = useLocale();
  const format = formattersFor(locale);
  const monthName = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const night = (booked: number) =>
    properties === 1
      ? booked > 0
        ? t("booked")
        : t("free")
      : t("bookedOf", { booked, properties });

  return (
    <figure className="space-y-2">
      <div className="space-y-1" role="list" aria-label={t("label")}>
        {months.map(({ month, days }) => {
          const booked = days.filter((d) => d.booked > 0).length;
          const label = t("month", {
            month: monthName.format(new Date(`${month}-01T00:00:00Z`)),
            year: month.slice(0, 4),
            booked,
            nights: days.length,
          });
          return (
            <div key={month} role="listitem" aria-label={label} className="flex items-center gap-2">
              <span className="text-muted-foreground w-8 shrink-0 text-xs" aria-hidden>
                {monthName.format(new Date(`${month}-01T00:00:00Z`))}
              </span>
              <div className="grid flex-1 grid-cols-[repeat(31,minmax(0,1fr))] gap-px" aria-hidden>
                {days.map((day) => (
                  <span
                    key={day.date}
                    title={t("night", { date: format.date(day.date), state: night(day.booked) })}
                    className="aspect-square rounded-[2px]"
                    style={{ backgroundColor: STEPS[heatStep(day.booked, properties, 4)] }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <figcaption className="text-muted-foreground flex items-center gap-2 text-xs">
        <span>{t("legendFree")}</span>
        {(properties === 1 ? [STEPS[0]!, STEPS[4]!] : STEPS).map((color) => (
          <span
            key={color}
            aria-hidden
            className="size-3 rounded-[2px]"
            style={{ backgroundColor: color }}
          />
        ))}
        <span>{properties === 1 ? t("legendBooked") : t("legendAll", { properties })}</span>
      </figcaption>
    </figure>
  );
}
