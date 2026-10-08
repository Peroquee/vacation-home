"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { CalendarBlock, CalendarBooking } from "@/lib/availability/calendar";
import { type CalendarDate } from "@/lib/calendar-date";
import {
  addMonths,
  layoutWeeks,
  type MonthKey,
  monthOf,
  monthWeeks,
  type Segment,
  type Span,
  type Weekday,
} from "@/lib/calendar/month";
import {
  type Conflict,
  describeConflict,
  previewTotalMinor,
  stayConflicts,
  turnoverFix,
} from "@/lib/bookings/form";
import {
  hover,
  IDLE,
  key as keyPress,
  nightsOf,
  type Outcome,
  press,
  release,
  type Selection,
  selectedDays,
  stayFrom,
} from "@/lib/calendar/selection";
import { formatDateRange, formatMoney } from "@/lib/format";
import { APP_LOCALE } from "@/lib/locale";
import { cn } from "@/lib/utils";

/** What the calendar needs of one property: who it is, and what is booked. */
export type CalendarProperty = {
  property: {
    id: string;
    name: string;
    color: string;
    /** For the selection's price hint; without them it shows nights only. */
    currency?: string;
    defaultNightlyRateMinor?: number;
    defaultCleaningFeeMinor?: number;
  };
  bookings: CalendarBooking[];
  blocks: CalendarBlock[];
};

type Bar = Span &
  (
    | { kind: "booking"; booking: CalendarBooking; property: CalendarProperty["property"] }
    | { kind: "block"; block: CalendarBlock; property: CalendarProperty["property"] }
  );

/** Black or white, whichever reads better on `hex`. */
function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear(r!) + 0.7152 * linear(g!) + 0.0722 * linear(b!);
  return luminance > 0.4 ? "#000000" : "#ffffff";
}

function barStyle(bar: Bar): React.CSSProperties {
  const color = bar.property.color;
  if (bar.kind === "block") {
    return {
      backgroundImage:
        "repeating-linear-gradient(135deg, var(--muted) 0 4px, color-mix(in oklch, var(--muted-foreground) 25%, transparent) 4px 8px)",
      color: "var(--foreground)",
      boxShadow: `inset 3px 0 0 ${color}`,
    };
  }
  if (bar.booking.status === "inquiry") {
    // Holds nothing yet: a tinted outline rather than a solid bar.
    return {
      backgroundColor: `color-mix(in oklch, ${color} 15%, var(--background))`,
      border: `1.5px dashed ${color}`,
      color: "var(--foreground)",
    };
  }
  return { backgroundColor: color, color: textOn(color) };
}

/**
 * Blocks shown before the server has them (an optimistic create) carry an
 * id with this prefix; they are drawn faded and are not clickable.
 */
export const PENDING_PREFIX = "pending-";
const isPending = (id: string) => id.startsWith(PENDING_PREFIX);

function barLabel(bar: Bar): string {
  const when = formatDateRange(bar.start, bar.end);
  if (bar.kind === "block") {
    const source = bar.block.origin === "google" ? ", from Google Calendar" : "";
    const saving = isPending(bar.block.id) ? ", saving" : "";
    return `Blocked${bar.block.reason ? `: ${bar.block.reason}` : ""}, ${bar.property.name}, ${when}${source}${saving}`;
  }
  const status = bar.booking.status === "inquiry" ? "inquiry" : "confirmed";
  return `${bar.booking.guest.name}, ${bar.property.name}, ${status}, ${when}`;
}

function BarView({
  segment,
  href,
  onClick,
  inTheWay = false,
}: {
  segment: Segment<Bar>;
  href?: string;
  /** For a bar that opens something in place, e.g. a block's editor. */
  onClick?: () => void;
  /** Stands in the way of the current selection: ringed in red. */
  inTheWay?: boolean;
}) {
  const bar = segment.span;
  const label = `${barLabel(bar)}${inTheWay ? ", in the way of the selected dates" : ""}`;
  const className = cn(
    "relative z-10 mx-px flex h-5 min-w-0 items-center overflow-hidden px-1 text-[11px] leading-none whitespace-nowrap sm:text-xs",
    // Rounded only where the stay really starts or ends, so a cut at a week
    // edge reads as "continues".
    !segment.continuesBefore && "rounded-l-full pl-1.5",
    !segment.continuesAfter && "rounded-r-full",
    href &&
      "hover:brightness-95 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
    inTheWay && "ring-destructive z-20 ring-2 ring-offset-1 motion-safe:animate-pulse",
  );
  const style: React.CSSProperties = {
    ...barStyle(bar),
    gridColumn: `${segment.fromLine} / ${segment.toLine}`,
    gridRow: segment.lane + 2,
  };
  // The grid lines, also as data, which tests and tooling can read without
  // a layout engine.
  const lines = {
    "data-bar": "",
    "data-from-line": segment.fromLine,
    "data-to-line": segment.toLine,
  };
  const text = bar.kind === "booking" ? bar.booking.guest.name : (bar.block.reason ?? "Blocked");
  const content = (
    <>
      {segment.continuesBefore ? <span aria-hidden>‹ </span> : null}
      <span className="truncate">{text}</span>
    </>
  );
  const pendingBlock = bar.kind === "block" && isPending(bar.block.id);
  if (pendingBlock) style.opacity = 0.6;
  if (onClick && !pendingBlock) {
    return (
      <button
        type="button"
        className={cn(className, "cursor-pointer text-left")}
        style={style}
        title={label}
        aria-label={label}
        onClick={onClick}
        {...lines}
      >
        {content}
      </button>
    );
  }
  return href ? (
    <Link
      href={href}
      className={className}
      style={style}
      title={label}
      aria-label={label}
      {...lines}
    >
      {content}
    </Link>
  ) : (
    <div className={className} style={style} title={label} role="img" aria-label={label} {...lines}>
      {content}
    </div>
  );
}

export type MonthCalendarProps = {
  /** The month shown, "2026-07". */
  month: MonthKey;
  /** 0 = Sunday … 6 = Saturday. */
  weekStart: Weekday;
  /** Highlighted as today. */
  today: CalendarDate;
  /** Properties in the order their bars stack; their bookings and blocks. */
  calendars: CalendarProperty[];
  onMonthChange: (month: MonthKey) => void;
  /** Where a booking's bar leads; without it, bars are not links. */
  bookingHref?: (bookingId: string) => string;
  /**
   * Called with a selected range that is free; without it, days cannot be
   * selected. A range that overlaps a stay or block is shown in red instead
   * and never reported.
   */
  onSelectRange?: (stay: {
    propertyId: string;
    checkIn: CalendarDate;
    checkOut: CalendarDate;
  }) => void;
  /** Called when a block's bar is clicked; without it, blocks are not interactive. */
  onBlockClick?: (block: CalendarBlock & { propertyId: string }) => void;
  /**
   * Bars to ring as being in the way, by key ("b-<booking id>" or
   * "k-<block id>"), e.g. after the server refused a write.
   */
  highlight?: string[];
  /** Shown while the next month's data is on its way. */
  pending?: boolean;
};

/**
 * A month of stays: a controlled component that draws what it is given and
 * reports navigation through `onMonthChange` and selections through
 * `onSelectRange`, fetching nothing itself. Stays are bars from mid check-in
 * to mid check-out, so a turnover day shows one stay leaving in the morning
 * half and the next arriving in the afternoon half. Confirmed stays are
 * solid in the property's colour, inquiries dashed, blocks hatched.
 *
 * Selecting: drag across days with a mouse, tap the first and last day on a
 * touch screen, or use the keyboard (arrows move, Shift+arrows extend,
 * Enter sets the start and the end, Escape cancels). The selection shows
 * its nights and total, and turns red if it overlaps a stay or block.
 */
export function MonthCalendar({
  month,
  weekStart,
  today,
  calendars,
  onMonthChange,
  bookingHref,
  onSelectRange,
  onBlockClick,
  highlight: ringed,
  pending = false,
}: MonthCalendarProps) {
  const weeks = useMemo(() => monthWeeks(month, weekStart), [month, weekStart]);
  const layout = useMemo(() => {
    const bars: Bar[] = calendars.flatMap(({ property, bookings, blocks }) =>
      [
        ...bookings.map((booking): Bar => ({
          kind: "booking",
          key: `b-${booking.id}`,
          start: booking.checkIn,
          end: booking.checkOut,
          booking,
          property,
        })),
        ...blocks.map((block): Bar => ({
          kind: "block",
          key: `k-${block.id}`,
          start: block.startDate,
          end: block.endDate,
          block,
          property,
        })),
      ].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)),
    );
    return layoutWeeks(weeks, bars);
  }, [weeks, calendars]);

  // --- Selection ------------------------------------------------------------
  const selectable = onSelectRange !== undefined && calendars.length > 0;
  const [selection, setSelection] = useState<Selection>(IDLE);
  /** A finished range that was refused, kept on screen until the next action. */
  const [refused, setRefused] = useState<{ checkIn: CalendarDate; checkOut: CalendarDate } | null>(
    null,
  );
  const [chosenPropertyId, setPropertyId] = useState<string | null>(null);
  const selected =
    calendars.find((c) => c.property.id === chosenPropertyId) ?? calendars[0] ?? null;
  const inGrid = (date: CalendarDate) => date >= weeks[0]![0]! && date <= weeks.at(-1)![6]!;
  const [focusedDay, setFocusedDay] = useState<CalendarDate | null>(null);
  const focusDay =
    focusedDay && inGrid(focusedDay)
      ? focusedDay
      : monthOf(today) === month
        ? today
        : `${month}-01`;
  const gridRef = useRef<HTMLDivElement>(null);

  const stay =
    refused ?? (selection.phase === "idle" ? null : stayFrom(selection.anchor, selection.focus));
  const conflicts = stay && selected ? stayConflicts(stay, selected) : [];
  const highlight = refused
    ? { from: refused.checkIn, to: refused.checkOut }
    : selectedDays(selection);
  const property = selected?.property;
  const total =
    stay && property?.currency
      ? previewTotalMinor({
          ...stay,
          nightlyRateMinor: property.defaultNightlyRateMinor ?? null,
          cleaningFeeMinor: property.defaultCleaningFeeMinor ?? null,
        })
      : null;

  function apply(outcome: Outcome) {
    setSelection(outcome.selection);
    if (outcome.selection.phase !== "idle") setRefused(null);
    if (!outcome.done || !selected) return;
    if (stayConflicts(outcome.done, selected).length > 0) {
      // Shown in red; the booking form is not opened for taken dates.
      setRefused(outcome.done);
      return;
    }
    setRefused(null);
    onSelectRange?.({ propertyId: selected.property.id, ...outcome.done });
  }

  // Escape abandons a selection wherever focus is.
  useEffect(() => {
    if (selection.phase === "idle" && !refused) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelection(IDLE);
      setRefused(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection.phase, refused]);

  // Keyboard focus follows the focused day, also into the next month.
  const wantFocus = useRef(false);
  useEffect(() => {
    if (!wantFocus.current) return;
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${focusDay}"]`)?.focus();
    wantFocus.current = false;
  }, [focusDay]);

  /** The day under a pointer: the day button it is on, or by position in its week row. */
  function dayAt(event: React.PointerEvent): CalendarDate | null {
    const target =
      document.elementFromPoint?.(event.clientX, event.clientY) ?? (event.target as Element);
    const button = target?.closest<HTMLElement>("[data-date]");
    if (button) return button.dataset.date!;
    const row = target?.closest<HTMLElement>("[data-week]");
    if (!row) return null;
    const rect = row.getBoundingClientRect();
    const index = Math.min(
      6,
      Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * 7)),
    );
    return weeks[Number(row.dataset.week)]?.[index] ?? null;
  }

  const pointer = selectable
    ? {
        onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
          if (event.button !== 0) return;
          // A bar is a link to its booking; let it be one.
          if ((event.target as Element).closest("[data-bar]")) return;
          const day = dayAt(event);
          if (!day) return;
          // Touch keeps scrolling; only a mouse or pen drags.
          if (event.pointerType !== "touch")
            event.currentTarget.setPointerCapture?.(event.pointerId);
          apply(press(selection, day));
        },
        onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
          if (event.pointerType === "touch" || selection.phase === "idle") return;
          const day = dayAt(event);
          if (day && day !== selection.focus) apply(hover(selection, day));
        },
        onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
          if (selection.phase === "idle") return;
          apply(release(selection, dayAt(event) ?? selection.focus));
        },
        onPointerCancel() {
          // The browser took the gesture over (a scroll): drop a drag, keep a waiting start.
          if (selection.phase === "dragging") setSelection(IDLE);
        },
      }
    : {};

  function onDayKeyDown(event: React.KeyboardEvent, date: CalendarDate) {
    const result = keyPress(selection, date, event);
    if (!result) return;
    event.preventDefault();
    if (result.focusDay !== date) {
      wantFocus.current = true;
      setFocusedDay(result.focusDay);
      if (!inGrid(result.focusDay)) onMonthChange(monthOf(result.focusDay));
    }
    if (selectable) apply(result);
  }

  // --- Rendering --------------------------------------------------------------
  const title = new Intl.DateTimeFormat(APP_LOCALE, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
  const weekday = new Intl.DateTimeFormat(APP_LOCALE, { weekday: "short", timeZone: "UTC" });
  const monthName = new Intl.DateTimeFormat(APP_LOCALE, { month: "long", timeZone: "UTC" });
  const fullDate = new Intl.DateTimeFormat(APP_LOCALE, { dateStyle: "full", timeZone: "UTC" });
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const thisYear = Number(today.slice(0, 4));
  const years = Array.from(
    new Set([...Array.from({ length: 6 }, (_, i) => thisYear - 2 + i), year]),
  ).sort((a, b) => a - b);
  const isSelected = (date: CalendarDate) =>
    highlight !== null && date >= highlight.from && date <= highlight.to;
  const taken = conflicts.length > 0;
  // Bar keys, so the calendar can ring what stands in the way.
  const inTheWay = new Set([
    ...conflicts.map((c) => `${c.kind === "booking" ? "b" : "k"}-${c.id}`),
    ...(ringed ?? []),
  ]);

  return (
    <section aria-labelledby="calendar-title" aria-busy={pending}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="calendar-title" className="text-lg font-medium">
          {title}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous month"
            onClick={() => onMonthChange(addMonths(month, -1))}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            variant="outline"
            onClick={() => onMonthChange(monthOf(today))}
            disabled={month === monthOf(today)}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next month"
            onClick={() => onMonthChange(addMonths(month, 1))}
          >
            <ChevronRight aria-hidden />
          </Button>
          <NativeSelect
            aria-label="Month"
            value={String(monthNumber)}
            onChange={(event) => onMonthChange(`${year}-${event.target.value.padStart(2, "0")}`)}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <NativeSelectOption key={i} value={String(i + 1)}>
                {monthName.format(new Date(Date.UTC(2026, i, 1)))}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Year"
            value={String(year)}
            onChange={(event) =>
              onMonthChange(`${event.target.value}-${String(monthNumber).padStart(2, "0")}`)
            }
          >
            {years.map((y) => (
              <NativeSelectOption key={y} value={String(y)}>
                {y}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>

      {selectable ? (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          {calendars.length > 1 ? (
            <NativeSelect
              aria-label="Property to book"
              size="sm"
              value={selected?.property.id}
              onChange={(event) => {
                setPropertyId(event.target.value);
                setRefused(null);
              }}
            >
              {calendars.map(({ property }) => (
                <NativeSelectOption key={property.id} value={property.id}>
                  {property.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : null}
          <p
            aria-live="polite"
            className={cn(
              "min-h-5",
              taken ? "text-destructive font-medium" : "text-muted-foreground",
            )}
          >
            {stay ? (
              <>
                {formatDateRange(stay.checkIn, stay.checkOut)}
                {" · "}
                {nightsOf(stay)} {nightsOf(stay) === 1 ? "night" : "nights"}
                {total !== null && property?.currency
                  ? ` · ${formatMoney(total, property.currency)}`
                  : null}
                {taken
                  ? ` · Not available: ${conflicts.map((c) => describeConflict(c, guestNames(selected))).join("; ")}`
                  : null}
                {refused ? ". Change the dates, or press Escape." : null}
              </>
            ) : selection.phase !== "idle" ? (
              "Now pick the last day (the check-out day), or press Escape."
            ) : (
              "Drag across days, or tap the first and last day, to start a booking."
            )}
          </p>
          {refused && taken ? (
            <ConflictHelp
              stay={refused}
              conflicts={conflicts}
              names={guestNames(selected)}
              bookingHref={bookingHref}
            />
          ) : null}
        </div>
      ) : null}

      <div
        ref={gridRef}
        className={cn(
          "rounded-card touch-manipulation border select-none",
          pending && "opacity-60 transition-opacity",
        )}
        {...pointer}
      >
        <div className="grid grid-cols-7 border-b" aria-hidden>
          {weeks[0]!.map((date) => (
            <div key={date} className="text-muted-foreground px-1 py-1.5 text-center text-xs">
              {weekday.format(new Date(`${date}T00:00:00Z`))}
            </div>
          ))}
        </div>

        {weeks.map((week, w) => {
          const lanes = Math.max(0, ...layout[w]!.map((s) => s.lane + 1));
          return (
            <div key={week[0]} data-week={w} className="relative border-b last:border-b-0">
              {/* Day cells behind the bars: borders, shading, selection. */}
              <div className="absolute inset-0 grid grid-cols-7" aria-hidden>
                {week.map((date) => (
                  <div
                    key={date}
                    className={cn(
                      "border-r last:border-r-0",
                      monthOf(date) !== month && "bg-muted/40",
                      isSelected(date) && (taken ? "bg-destructive/15" : "bg-primary/15"),
                    )}
                  />
                ))}
              </div>
              <div
                className="relative grid grid-cols-[repeat(14,minmax(0,1fr))] gap-y-1 pb-2"
                style={{ gridTemplateRows: `auto repeat(${lanes}, 1.25rem)` }}
              >
                {week.map((date, d) => (
                  <div
                    key={date}
                    className="px-1 pt-1 text-xs sm:text-sm"
                    style={{ gridColumn: `${d * 2 + 1} / span 2`, gridRow: 1 }}
                  >
                    <button
                      type="button"
                      data-date={date}
                      tabIndex={date === focusDay ? 0 : -1}
                      aria-label={fullDate.format(new Date(`${date}T00:00:00Z`))}
                      aria-current={date === today ? "date" : undefined}
                      onFocus={() => setFocusedDay(date)}
                      onKeyDown={(event) => onDayKeyDown(event, date)}
                      className={cn(
                        "focus-visible:ring-ring inline-flex size-6 items-center justify-center rounded-full tabular-nums outline-none focus-visible:ring-2",
                        monthOf(date) !== month && "text-muted-foreground",
                        date === today && "bg-primary text-primary-foreground font-medium",
                        !selectable && "cursor-default",
                      )}
                    >
                      <time dateTime={date}>{Number(date.slice(8))}</time>
                    </button>
                  </div>
                ))}
                {layout[w]!.map((segment) => (
                  <BarView
                    key={segment.span.key}
                    segment={segment}
                    inTheWay={inTheWay.has(segment.span.key)}
                    onClick={
                      segment.span.kind === "block" && onBlockClick
                        ? () => {
                            const { block, property } = segment.span as Extract<
                              Bar,
                              { kind: "block" }
                            >;
                            onBlockClick({ ...block, propertyId: property.id });
                          }
                        : undefined
                    }
                    href={
                      segment.span.kind === "booking" && bookingHref
                        ? bookingHref(segment.span.booking.id)
                        : undefined
                    }
                  />
                ))}
                {/* Keeps an empty week as tall as one with a lane. */}
                {lanes === 0 ? <div className="h-5" style={{ gridRow: 2 }} /> : null}
              </div>
            </div>
          );
        })}
      </div>

      <Legend calendars={calendars} />
    </section>
  );
}

/**
 * What to do about a refused selection: open what is in the way, and, when
 * it is one night off a changeover, which day would work.
 */
function ConflictHelp({
  stay,
  conflicts,
  names,
  bookingHref,
}: {
  stay: { checkIn: CalendarDate; checkOut: CalendarDate };
  conflicts: Conflict[];
  names: ReadonlyMap<string, string>;
  bookingHref?: (id: string) => string;
}) {
  return (
    <ul className="w-full space-y-1">
      {conflicts.map((conflict) => {
        const fix = turnoverFix(stay, conflict);
        return (
          <li key={`${conflict.kind}-${conflict.id}`} className="flex flex-wrap gap-x-2">
            {conflict.kind === "booking" && bookingHref ? (
              <Link href={bookingHref(conflict.id)} className="text-destructive underline">
                Open{" "}
                {describeConflict(conflict, names)
                  .replace(/^Booked by /, "the booking of ")
                  .replace(/^Booked, /, "the booking, ")}
              </Link>
            ) : null}
            {fix ? <span className="text-muted-foreground">{fix.message}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Guest names by booking id, for naming what a selection overlaps. */
function guestNames(calendar: CalendarProperty | null): ReadonlyMap<string, string> {
  return new Map(calendar?.bookings.map((b) => [b.id, b.guest.name]) ?? []);
}

function Legend({ calendars }: { calendars: CalendarProperty[] }) {
  const sample = calendars[0]?.property.color ?? "#0f766e";
  const swatch = "inline-block h-3 w-6 rounded-full";
  return (
    <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
      <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Properties">
        {calendars.map(({ property }) => (
          <li key={property.id} className="flex items-center gap-1.5">
            <span className={swatch} style={{ backgroundColor: property.color }} aria-hidden />
            {property.name}
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Status">
        <li className="flex items-center gap-1.5">
          <span className={swatch} style={{ backgroundColor: sample }} aria-hidden />
          Confirmed
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className={swatch}
            style={{
              border: `1.5px dashed ${sample}`,
              backgroundColor: `color-mix(in oklch, ${sample} 15%, transparent)`,
            }}
            aria-hidden
          />
          Inquiry (dates not held)
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className={swatch}
            style={barStyle({
              kind: "block",
              key: "",
              start: "",
              end: "",
              block: { id: "", startDate: "", endDate: "", reason: null, origin: "manual" },
              property: { id: "", name: "", color: sample },
            })}
            aria-hidden
          />
          Blocked
        </li>
      </ul>
    </div>
  );
}
