"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { PriceLines } from "@/components/price-lines";
import { useFormat } from "@/i18n/use-format";
import type { SentRequest } from "@/lib/booking-requests/service";
import { formatReference } from "@/lib/booking-requests/values";
import type { PublicAvailability } from "@/lib/booking-rules/public-availability";
import { checkOutOptions, type PublicNight } from "@/lib/booking-rules/public-nights";
import { tryPriceStay } from "@/lib/pricing/engine";
import { addDays, type CalendarDate, daysBetween, toUtcDate } from "@/lib/calendar-date";
import {
  addMonths,
  gridRange,
  type MonthKey,
  monthWeeks,
  weekStartFor,
} from "@/lib/calendar/month";
import type { PublicCancellation } from "@/lib/properties/public";

import { CancellationNote } from "./cancellation-note";

type Stay = { checkIn: CalendarDate | null; checkOut: CalendarDate | null };

/** Loaded once the guest asks to request a stay, not with the page. */
const RequestForm = dynamic(() => import("./request-form").then((m) => m.RequestForm), {
  ssr: false,
});

/** Months shown side by side on wider screens; one at a time on a phone. */
const MONTHS = 2;

/**
 * Pick a stay on the public page (GitLab #108): tap the arrival day, then
 * the departure day. Only arrival days the booking rules allow can be
 * picked, then only departures that keep every night free and the stay
 * within its minimum and maximum length. Shows a price estimate computed
 * exactly as a booking's default total. Mobile first: one month, swiped
 * through with the arrows; two side by side from `sm` up. Then the request
 * form (GitLab #109), and once sent, its confirmation in place of it all.
 */
export function StayPicker({
  slug,
  firstMonth,
  maxGuests,
  cancellation,
}: {
  slug: string;
  firstMonth: MonthKey;
  maxGuests: number | null;
  cancellation: PublicCancellation;
}) {
  const t = useTranslations("stay.picker");
  const tPricing = useTranslations("pricing");
  const format = useFormat();
  const [month, setMonth] = useState(firstMonth);
  const [data, setData] = useState<{ key: string; value: PublicAvailability } | null>(null);
  const [failed, setFailed] = useState(false);
  const [stay, setStay] = useState<Stay>({ checkIn: null, checkOut: null });
  const [requesting, setRequesting] = useState(false);
  const [sent, setSent] = useState<SentRequest | null>(null);
  // Bumped to load the free dates again, past the browser's cache.
  const [reload, setReload] = useState(0);
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
          ...(reload > 0 && { cache: "reload" as const }),
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
  }, [slug, key, window, reload]);

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
    setRequesting(false);
    if (stay.checkIn && !stay.checkOut && departures.has(date)) {
      setStay({ checkIn: stay.checkIn, checkOut: date });
    } else if (nights.get(date)?.checkIn) {
      setStay({ checkIn: date, checkOut: null });
    }
  }

  const length = stay.checkIn && stay.checkOut ? daysBetween(stay.checkIn, stay.checkOut) : null;
  // The same engine and rules as the booking's total (GitLab #118).
  const price =
    stay.checkIn && stay.checkOut && availability
      ? tryPriceStay(availability.pricing, { checkIn: stay.checkIn, checkOut: stay.checkOut })
      : null;
  const total = price?.totalMinor ?? null;
  const currency = availability?.pricing.currency ?? "";

  if (sent) return <RequestSent request={sent} />;

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
          <PriceLines breakdown={price!} className="pt-1" />
          {/* The Kurtaxe needs the guests: it follows in the request form (GitLab #120). */}
          {availability.pricing.touristTax ? (
            <p className="text-muted-foreground text-xs">
              {tPricing(availability.pricing.touristTax.included ? "includedTax" : "plusTax")}
            </p>
          ) : null}
          <p className="text-muted-foreground text-xs">{t("estimateNote")}</p>
          {/* The policy, by this total; in the form, above the consent. */}
          {!requesting ? (
            <CancellationNote
              policy={cancellation}
              currency={currency}
              totalMinor={total}
              className="text-muted-foreground text-xs"
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-4 pt-2">
            {!requesting ? (
              <button
                type="button"
                className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
                onClick={() => setRequesting(true)}
              >
                {t("request")}
              </button>
            ) : null}
            <button
              type="button"
              className="text-sm underline"
              onClick={() => {
                setRequesting(false);
                setStay({ checkIn: null, checkOut: null });
              }}
            >
              {t("clear")}
            </button>
          </div>
          {requesting ? (
            <div className="border-t pt-4">
              <RequestForm
                slug={slug}
                checkIn={stay.checkIn}
                checkOut={stay.checkOut}
                maxGuests={maxGuests}
                pricing={availability.pricing}
                cancellation={
                  <CancellationNote
                    policy={cancellation}
                    currency={currency}
                    totalMinor={total}
                    className="text-sm"
                  />
                }
                onSent={setSent}
                onDatesRefused={() => setReload((n) => n + 1)}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** The confirmation once a request is sent: its reference and what was asked for. */
function RequestSent({ request }: { request: SentRequest }) {
  const t = useTranslations("stay.sent");
  const format = useFormat();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: "start" });
  }, []);
  return (
    <section
      aria-labelledby="request-sent-heading"
      className="space-y-3 rounded-xl border p-4"
      data-testid="request-sent"
    >
      <h2
        id="request-sent-heading"
        ref={heading}
        tabIndex={-1}
        className="text-lg font-semibold outline-none"
      >
        {t("heading")}
      </h2>
      <p>{t("body")}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t("reference")}</dt>
        <dd className="font-mono text-base font-semibold">{formatReference(request.reference)}</dd>
        <dt className="text-muted-foreground">{t("dates")}</dt>
        <dd>
          {format.dateRange(request.checkIn, request.checkOut)} ·{" "}
          {t("nights", { count: request.nights })}
        </dd>
        <dt className="text-muted-foreground">{t("guests")}</dt>
        <dd>{request.guestCount}</dd>
        <dt className="text-muted-foreground">{t("estimate")}</dt>
        <dd>{format.money(request.totalAmountMinor, request.currency)}</dd>
      </dl>
      <p className="text-muted-foreground text-sm">{t("keepReference")}</p>
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
