"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { useFormat } from "@/i18n/use-format";
import type { PublicAvailability } from "@/lib/booking-rules/public-availability";
import { checkOutOptions, type PublicNight } from "@/lib/booking-rules/public-nights";
import { calculateTotalMinor } from "@/lib/bookings/pricing";
import { addDays, type CalendarDate, daysBetween, toUtcDate } from "@/lib/calendar-date";
import {
  addMonths,
  gridRange,
  type MonthKey,
  monthWeeks,
  weekStartFor,
} from "@/lib/calendar/month";

type Stay = { checkIn: CalendarDate | null; checkOut: CalendarDate | null };

/** Months shown side by side on wider screens; one at a time on a phone. */
const MONTHS = 2;

/**
 * Pick a stay on the public page (GitLab #108): tap the arrival day, then
 * the departure day. Only arrival days the booking rules allow can be
 * picked, then only departures that keep every night free and the stay
 * within its minimum and maximum length. Shows a price estimate computed
 * exactly as a booking's default total. Mobile first: one month, swiped
 * through with the arrows; two side by side from `sm` up.
 */
export function StayPicker({ slug, firstMonth }: { slug: string; firstMonth: MonthKey }) {
  const t = useTranslations("stay.picker");
  const format = useFormat();
  const [month, setMonth] = useState(firstMonth);
  const [data, setData] = useState<{ key: string; value: PublicAvailability } | null>(null);
  const [failed, setFailed] = useState(false);
  const [stay, setStay] = useState<Stay>({ checkIn: null, checkOut: null });
  const weekStart = weekStartFor(format.locale);

  const months = useMemo(
    () => Array.from({ length: MONTHS }, (_, i) => addMonths(month, i)),
    [month],
  );
  // One request for every day the shown grids hold, plus the longest
  // departure a stay starting in them could need.
  const window = useMemo(() => {
    const first = gridRange(monthWeeks(months[0]!, weekStart));
    const last = gridRange(monthWeeks(months.at(-1)!, weekStart));
    return { from: first.start, to: addDays(last.end, 31) };
  }, [months, weekStart]);
  const key = `${window.from}|${window.to}`;

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const params = new URLSearchParams(window);
        const response = await fetch(`/api/public/properties/${slug}/availability?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const value: PublicAvailability = await response.json();
        setData({ key, value });
        setFailed(false);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [slug, key, window]);

  const availability = data?.key === key ? data.value : null;
  const nights = useMemo(
    () => new Map(availability?.nights.map((n) => [n.date, n]) ?? []),
    [availability],
  );
  const departures = useMemo(
    () =>
      stay.checkIn && availability
        ? new Set(checkOutOptions(stay.checkIn, availability.nights, availability))
        : new Set<string>(),
    [stay.checkIn, availability],
  );

  function choose(date: CalendarDate) {
    if (stay.checkIn && !stay.checkOut && departures.has(date)) {
      setStay({ checkIn: stay.checkIn, checkOut: date });
    } else if (nights.get(date)?.checkIn) {
      setStay({ checkIn: date, checkOut: null });
    }
  }

  const length = stay.checkIn && stay.checkOut ? daysBetween(stay.checkIn, stay.checkOut) : null;
  const total =
    stay.checkIn && stay.checkOut && availability
      ? calculateTotalMinor({
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
          nightlyRateMinor: availability.nightlyRateMinor,
          cleaningFeeMinor: availability.cleaningFeeMinor,
        })
      : null;

  return (
    <section aria-labelledby="stay-picker-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="stay-picker-heading" className="text-lg font-semibold">
          {t("heading")}
        </h2>
        <div className="flex gap-1">
          <button
            type="button"
            className="hover:bg-muted rounded-md border p-2 disabled:opacity-40"
            aria-label={t("previous")}
            disabled={month <= firstMonth}
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            className="hover:bg-muted rounded-md border p-2"
            aria-label={t("next")}
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </div>
      </div>

      <p className="text-muted-foreground text-sm" aria-live="polite">
        {failed
          ? t("failed")
          : !availability
            ? t("loading")
            : !stay.checkIn
              ? t("chooseArrival", { min: availability.minNights })
              : !stay.checkOut
                ? t("chooseDeparture")
                : null}
      </p>

      <div className="grid gap-6 sm:grid-cols-2">
        {months.map((m, i) => (
          <Month
            key={m}
            month={m}
            className={i > 0 ? "hidden sm:block" : undefined}
            weekStart={weekStart}
            nights={nights}
            stay={stay}
            departures={departures}
            loaded={availability !== null}
            onChoose={choose}
          />
        ))}
      </div>

      <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <li className="flex items-center gap-1">
          <span aria-hidden className="bg-background size-3 rounded-sm border" />
          {t("legendFree")}
        </li>
        <li className="flex items-center gap-1">
          <span aria-hidden className="bg-muted size-3 rounded-sm border" />
          {t("legendTaken")}
        </li>
        <li className="flex items-center gap-1">
          <span aria-hidden className="bg-primary size-3 rounded-sm" />
          {t("legendStay")}
        </li>
      </ul>

      {stay.checkIn && stay.checkOut && length !== null && total !== null && availability ? (
        <div className="space-y-1 rounded-xl border p-4" data-testid="stay-estimate">
          <p className="font-medium">{format.dateRange(stay.checkIn, stay.checkOut)}</p>
          <p className="text-sm">
            {availability.cleaningFeeMinor > 0
              ? t("breakdownWithCleaning", {
                  nights: length,
                  rate: format.money(availability.nightlyRateMinor, availability.currency),
                  cleaning: format.money(availability.cleaningFeeMinor, availability.currency),
                })
              : t("breakdown", {
                  nights: length,
                  rate: format.money(availability.nightlyRateMinor, availability.currency),
                })}
          </p>
          <p className="text-lg font-semibold">
            {t("total", { total: format.money(total, availability.currency) })}
          </p>
          <p className="text-muted-foreground text-xs">{t("estimateNote")}</p>
          <button
            type="button"
            className="text-sm underline"
            onClick={() => setStay({ checkIn: null, checkOut: null })}
          >
            {t("clear")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Month({
  month,
  className,
  weekStart,
  nights,
  stay,
  departures,
  loaded,
  onChoose,
}: {
  month: MonthKey;
  className?: string;
  weekStart: ReturnType<typeof weekStartFor>;
  nights: ReadonlyMap<CalendarDate, PublicNight>;
  stay: Stay;
  departures: ReadonlySet<CalendarDate>;
  loaded: boolean;
  onChoose: (date: CalendarDate) => void;
}) {
  const t = useTranslations("stay.picker");
  const format = useFormat();
  const weeks = monthWeeks(month, weekStart);
  const title = new Intl.DateTimeFormat(format.locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(toUtcDate(`${month}-01`));
  const weekdays = weeks[0]!.map((date) =>
    new Intl.DateTimeFormat(format.locale, { weekday: "narrow", timeZone: "UTC" }).format(
      toUtcDate(date),
    ),
  );

  return (
    <div className={className}>
      <h3 className="mb-2 text-center text-sm font-medium">{title}</h3>
      <table className="w-full table-fixed border-collapse text-center text-sm">
        <thead>
          <tr>
            {weekdays.map((day, i) => (
              <th key={i} scope="col" className="text-muted-foreground pb-1 text-xs font-normal">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((date) => {
                if (!date.startsWith(month)) return <td key={date} />;
                const night = nights.get(date);
                const inStay =
                  stay.checkIn !== null &&
                  date >= stay.checkIn &&
                  (stay.checkOut ? date <= stay.checkOut : date === stay.checkIn);
                const departure = stay.checkIn !== null && !stay.checkOut && departures.has(date);
                const selectable = departure || Boolean(night?.checkIn);
                const state = !loaded
                  ? ""
                  : inStay
                    ? t("daySelected")
                    : departure
                      ? t("dayDeparture")
                      : night?.checkIn
                        ? t("dayArrival")
                        : night?.available
                          ? t("dayFree")
                          : t("dayTaken");
                return (
                  <td key={date} className="p-0.5">
                    <button
                      type="button"
                      data-date={date}
                      disabled={!loaded || !selectable}
                      aria-pressed={inStay}
                      aria-label={`${format.date(date, { style: "full" })}${state ? `: ${state}` : ""}`}
                      onClick={() => onChoose(date)}
                      className={[
                        "aspect-square w-full rounded-md text-sm tabular-nums transition-colors",
                        inStay
                          ? "bg-primary text-primary-foreground"
                          : night?.available || departure
                            ? "bg-background hover:bg-muted border"
                            : "bg-muted text-muted-foreground line-through",
                        selectable && !inStay ? "font-medium" : "",
                        !selectable && !inStay ? "cursor-default" : "",
                      ].join(" ")}
                    >
                      {Number(date.slice(8))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
