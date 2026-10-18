"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useConflictText } from "@/components/use-conflict-text";
import { type Formatters } from "@/i18n/format";
import { useFormat } from "@/i18n/use-format";
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
import { type Conflict, previewPrice, stayConflicts, turnoverFix } from "@/lib/bookings/form";
import type { PricingRules } from "@/lib/pricing/engine";
import { holdsDates } from "@/lib/bookings/values";
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
import { type DragMode, draggedStay, pastThreshold, type Stay } from "@/lib/calendar/drag";
import { guestDisplayName } from "@/lib/guests/display";
import { cn } from "@/lib/utils";

/** What the calendar needs of one property: who it is, and what is booked. */
export type CalendarProperty = {
  property: {
    id: string;
    name: string;
    color: string;
    /** For the selection's price hint; without it, it shows nights only. */
    pricing?: PricingRules;
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

/** Height of a cell's day number, above the first lane of bars. */
const DAY_HEADER = "2rem";
/** One lane of bars: a 1.25rem bar and 0.25rem of air. */
const LANE = "1.5rem";

/**
 * Blocks shown before the server has them (an optimistic create) carry an
 * id with this prefix; they are drawn faded and are not clickable.
 */
export const PENDING_PREFIX = "pending-";
const isPending = (id: string) => id.startsWith(PENDING_PREFIX);

type Translate = ReturnType<typeof useTranslations<"calendar.month">>;

function barLabel(bar: Bar, t: Translate, format: Formatters, guest: string): string {
  const when = format.dateRange(bar.start, bar.end);
  const property = bar.property.name;
  if (bar.kind === "block") {
    const { reason } = bar.block;
    return (
      (reason
        ? t("blockLabelWhy", { reason, property, when })
        : t("blockLabel", { property, when })) +
      (bar.block.origin === "google" ? t("fromGoogle") : "") +
      (isPending(bar.block.id) ? t("saving") : "")
    );
  }
  const status =
    bar.booking.status === "inquiry"
      ? t("inquiry")
      : bar.booking.status === "reserved"
        ? t("reserved")
        : t("confirmed");
  return t("bookingLabel", { guest, property, status, when });
}

function BarView({
  segment,
  href,
  onClick,
  inTheWay = false,
  onDragStart,
  dragging = false,
  takeSuppressedClick,
}: {
  segment: Segment<Bar>;
  href?: string;
  /** For a bar that opens something in place, e.g. a block's editor. */
  onClick?: () => void;
  /** Stands in the way of the current selection: ringed in red. */
  inTheWay?: boolean;
  /** For a booking that can be dragged to new dates (GitLab #66). */
  onDragStart?: (event: React.PointerEvent, mode: DragMode) => void;
  /** This booking is being dragged: drawn faded. */
  dragging?: boolean;
  /** True once for the click that ends a drag, so it does not open the booking. */
  takeSuppressedClick?: () => boolean;
}) {
  const t = useTranslations("calendar.month");
  const purgedName = useTranslations("guests")("purgedName");
  const format = useFormat();
  const bar = segment.span;
  const guest = bar.kind === "booking" ? guestDisplayName(bar.booking.guest.name, purgedName) : "";
  const label = barLabel(bar, t, format, guest) + (inTheWay ? t("inTheWay") : "");
  const className = cn(
    "z-10 flex h-5 min-w-0 items-center overflow-hidden px-1 text-[11px] leading-none whitespace-nowrap sm:text-xs",
    // Rounded only where the stay really starts or ends, so a cut at a week
    // edge reads as "continues".
    !segment.continuesBefore && "rounded-l-full pl-1.5",
    !segment.continuesAfter && "rounded-r-full",
    href &&
      "hover:brightness-95 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
    inTheWay && "ring-destructive z-20 ring-2 ring-offset-1 motion-safe:animate-pulse",
    onDragStart && "cursor-grab active:cursor-grabbing",
    dragging && "opacity-50",
  );
  // Positioned within the cell of the bar's first day: half-day columns
  // become fractions of that cell's width, and the lane a row below the
  // day numbers. 1px either side keeps touching bars apart.
  const halves = segment.toLine - segment.fromLine;
  const startsMidDay = (segment.fromLine - 1) % 2 === 1;
  const style: React.CSSProperties = {
    ...barStyle(bar),
    position: "absolute",
    left: `calc(${startsMidDay ? 50 : 0}% + 1px)`,
    width: `calc(${halves * 50}% - 2px)`,
    top: `calc(${DAY_HEADER} + ${segment.lane} * ${LANE})`,
  };
  // The grid lines, also as data, which tests and tooling can read without
  // a layout engine.
  const lines = {
    "data-bar": "",
    "data-from-line": segment.fromLine,
    "data-to-line": segment.toLine,
    "data-lane": segment.lane,
  };
  const text = bar.kind === "booking" ? guest : (bar.block.reason ?? t("blocked"));
  const content = (
    <>
      {onDragStart && !segment.continuesBefore ? (
        <span
          aria-hidden
          data-drag-handle="start"
          className="absolute inset-y-0 left-0 w-2 cursor-ew-resize"
        />
      ) : null}
      {segment.continuesBefore ? <span aria-hidden>‹ </span> : null}
      <span className="truncate">{text}</span>
      {onDragStart && !segment.continuesAfter ? (
        <span
          aria-hidden
          data-drag-handle="end"
          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize"
        />
      ) : null}
    </>
  );
  // A drag starts on the body (move) or an edge (check-in or check-out).
  const drag = onDragStart
    ? {
        draggable: false,
        onPointerDown(event: React.PointerEvent) {
          if (event.button !== 0 || event.pointerType === "touch") return;
          const handle = (event.target as Element).closest<HTMLElement>("[data-drag-handle]");
          onDragStart(event, (handle?.dataset.dragHandle as DragMode | undefined) ?? "move");
        },
        onClick(event: React.MouseEvent) {
          if (takeSuppressedClick?.()) event.preventDefault();
        },
      }
    : {};
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
      {...drag}
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
  /**
   * Called when a booking's bar is dragged to free dates (GitLab #66), with
   * its old and new stay; without it, bars cannot be dragged. Nothing is
   * saved here: the caller confirms first.
   */
  onBookingDrag?: (change: BookingDrag) => void;
};

export type BookingDrag = {
  bookingId: string;
  propertyId: string;
  guest: string;
  from: Stay;
  to: Stay;
};

type DragState = {
  bookingId: string;
  propertyId: string;
  guest: string;
  status: CalendarBooking["status"];
  mode: DragMode;
  stay: Stay;
  originDay: CalendarDate;
  startX: number;
  startY: number;
  /** Past the threshold: a drag, not a click. */
  active: boolean;
  /** The stay it would make, or null while unchanged or impossible. */
  to: Stay | null;
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
  onBookingDrag,
}: MonthCalendarProps) {
  const t = useTranslations("calendar.month");
  const purgedName = useTranslations("guests")("purgedName");
  const format = useFormat();
  const conflictText = useConflictText();
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
  const pricing = property?.pricing;
  const total =
    stay && pricing
      ? (previewPrice(pricing, {
          ...stay,
          nightlyRateMinor: null,
          cleaningFeeMinor: pricing.defaultCleaningFeeMinor,
        })?.totalMinor ?? null)
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
  function dayAt(event: { clientX: number; clientY: number; target: EventTarget | null }) {
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

  // --- Dragging a booking (GitLab #66) ----------------------------------------
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);
  const suppressClick = useRef(false);
  const takeSuppressedClick = () => {
    const suppressed = suppressClick.current;
    suppressClick.current = false;
    return suppressed;
  };
  const dragCalendar = drag ? calendars.find((c) => c.property.id === drag.propertyId) : undefined;
  const dragConflicts =
    drag?.active && drag.to && dragCalendar
      ? stayConflicts(drag.to, dragCalendar, drag.bookingId)
      : [];
  // Like the API: only a confirmed booking is refused for taken dates.
  const dragRefused = !!drag && holdsDates(drag.status) && dragConflicts.length > 0;

  function startDrag(
    event: React.PointerEvent,
    bar: Extract<Bar, { kind: "booking" }>,
    mode: DragMode,
  ) {
    // Where the pointer is; failing that, the edge being moved (or check-in).
    const originDay = dayAt(event) ?? (mode === "end" ? bar.booking.checkOut : bar.booking.checkIn);
    suppressClick.current = false;
    setDrag({
      bookingId: bar.booking.id,
      propertyId: bar.property.id,
      guest: guestDisplayName(bar.booking.guest.name, purgedName),
      status: bar.booking.status,
      mode,
      stay: { checkIn: bar.booking.checkIn, checkOut: bar.booking.checkOut },
      originDay,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      to: null,
    });
  }

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const active =
        current.active ||
        pastThreshold(event.clientX - current.startX, event.clientY - current.startY);
      if (!active) return;
      const day = dayAt(event);
      const to = day ? draggedStay(current.stay, current.mode, current.originDay, day) : current.to;
      if (
        active !== current.active ||
        to?.checkIn !== current.to?.checkIn ||
        to?.checkOut !== current.to?.checkOut
      ) {
        setDrag({ ...current, active, to });
      }
    };
    const up = () => {
      const current = dragRef.current;
      setDrag(null);
      if (!current?.active) return;
      // A drag ends with a click on the bar; it must not open the booking.
      suppressClick.current = true;
      const calendar = calendars.find((c) => c.property.id === current.propertyId);
      if (!current.to || !calendar) return;
      const refused =
        holdsDates(current.status) &&
        stayConflicts(current.to, calendar, current.bookingId).length > 0;
      if (refused) return;
      onBookingDrag?.({
        bookingId: current.bookingId,
        propertyId: current.propertyId,
        guest: current.guest,
        from: current.stay,
        to: current.to,
      });
    };
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (dragRef.current?.active) suppressClick.current = true;
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", cancel);
    };
    // Listeners for the drag's lifetime; the latest state is read from dragRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.bookingId, drag?.mode]);

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
  const locale = format.locale;
  const title = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const weekdayLong = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  const monthName = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" });
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const thisYear = Number(today.slice(0, 4));
  const years = Array.from(
    new Set([...Array.from({ length: 6 }, (_, i) => thisYear - 2 + i), year]),
  ).sort((a, b) => a - b);
  const dragging = drag?.active && drag.to ? { from: drag.to.checkIn, to: drag.to.checkOut } : null;
  const shown = dragging ?? highlight;
  const isSelected = (date: CalendarDate) =>
    shown !== null && date >= shown.from && date <= shown.to;
  const taken = dragging ? dragRefused : conflicts.length > 0;
  // Bar keys, so the calendar can ring what stands in the way.
  const inTheWay = new Set([
    ...(dragging ? dragConflicts : conflicts).map(
      (c) => `${c.kind === "booking" ? "b" : "k"}-${c.id}`,
    ),
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
            aria-label={t("previous")}
            onClick={() => onMonthChange(addMonths(month, -1))}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            variant="outline"
            onClick={() => onMonthChange(monthOf(today))}
            disabled={month === monthOf(today)}
          >
            {t("today")}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={t("next")}
            onClick={() => onMonthChange(addMonths(month, 1))}
          >
            <ChevronRight aria-hidden />
          </Button>
          <NativeSelect
            aria-label={t("month")}
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
            aria-label={t("year")}
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

      {drag?.active ? (
        <p
          aria-live="polite"
          className={cn(
            "mb-2 min-h-5 text-sm",
            dragRefused ? "text-destructive font-medium" : "text-muted-foreground",
          )}
        >
          {drag.to
            ? t("dragTo", {
                guest: drag.guest,
                range: format.dateRange(drag.to.checkIn, drag.to.checkOut),
                nights: nightsOf(drag.to),
              }) +
              (dragRefused
                ? t("notAvailable", {
                    conflicts: dragConflicts
                      .map((c) =>
                        conflictText.describe(c, guestNames(dragCalendar ?? null, purgedName)),
                      )
                      .join("; "),
                  })
                : "")
            : t("dragHint")}
        </p>
      ) : null}

      {selectable ? (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          {calendars.length > 1 ? (
            <NativeSelect
              aria-label={t("propertyToBook")}
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
                {format.dateRange(stay.checkIn, stay.checkOut)}
                {" · "}
                {t("nights", { count: nightsOf(stay) })}
                {total !== null && pricing ? ` · ${format.money(total, pricing.currency)}` : null}
                {taken
                  ? t("notAvailable", {
                      conflicts: conflicts
                        .map((c) => conflictText.describe(c, guestNames(selected, purgedName)))
                        .join("; "),
                    })
                  : null}
                {refused ? t("refused") : null}
              </>
            ) : selection.phase !== "idle" ? (
              t("pickLast")
            ) : (
              t("hint")
            )}
          </p>
          {refused && taken ? (
            <ConflictHelp
              stay={refused}
              conflicts={conflicts}
              names={guestNames(selected, purgedName)}
              bookingHref={bookingHref}
            />
          ) : null}
        </div>
      ) : null}

      {/*
       * An ARIA grid: a row per week, a cell per day. Each cell holds its day
       * button (the roving focus target) and the bars that start in it, so
       * every bar belongs to a cell; bars reach into the following cells by
       * CSS only. Arrow keys move between days (see onDayKeyDown).
       */}
      <div
        ref={gridRef}
        role="grid"
        aria-labelledby="calendar-title"
        aria-describedby={selectable ? "calendar-keys" : undefined}
        className={cn(
          "rounded-card touch-manipulation border select-none",
          pending && "opacity-60 transition-opacity",
        )}
        {...pointer}
      >
        <div role="row" className="grid grid-cols-7 border-b">
          {weeks[0]!.map((date) => (
            <div
              key={date}
              role="columnheader"
              aria-label={weekdayLong.format(new Date(`${date}T00:00:00Z`))}
              className="text-muted-foreground px-1 py-1.5 text-center text-xs"
            >
              {weekday.format(new Date(`${date}T00:00:00Z`))}
            </div>
          ))}
        </div>

        {weeks.map((week, w) => {
          const lanes = Math.max(0, ...layout[w]!.map((s) => s.lane + 1));
          return (
            <div
              key={week[0]}
              role="row"
              data-week={w}
              className="grid grid-cols-7 border-b last:border-b-0"
              // Room for the day numbers, then a lane per stack of bars.
              style={{
                minHeight: `calc(${DAY_HEADER} + ${Math.max(lanes, 1)} * ${LANE} + 0.5rem)`,
              }}
            >
              {week.map((date, d) => (
                <div
                  key={date}
                  role="gridcell"
                  aria-selected={selectable ? isSelected(date) : undefined}
                  className={cn(
                    "relative border-r px-1 pt-1 text-xs last:border-r-0 sm:text-sm",
                    monthOf(date) !== month && "bg-muted/40",
                    isSelected(date) && (taken ? "bg-destructive/15" : "bg-primary/15"),
                  )}
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
                  {layout[w]!.filter((segment) => Math.floor((segment.fromLine - 1) / 2) === d).map(
                    (segment) => (
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
                        onDragStart={
                          segment.span.kind === "booking" && onBookingDrag && bookingHref
                            ? (event, mode) =>
                                startDrag(
                                  event,
                                  segment.span as Extract<Bar, { kind: "booking" }>,
                                  mode,
                                )
                            : undefined
                        }
                        dragging={
                          drag?.active === true &&
                          segment.span.kind === "booking" &&
                          segment.span.booking.id === drag.bookingId
                        }
                        takeSuppressedClick={takeSuppressedClick}
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {selectable ? (
        <p id="calendar-keys" className="sr-only">
          {t("keys")}
        </p>
      ) : null}

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
  const text = useConflictText();
  return (
    <ul className="w-full space-y-1">
      {conflicts.map((conflict) => {
        const fix = turnoverFix(stay, conflict);
        return (
          <li key={`${conflict.kind}-${conflict.id}`} className="flex flex-wrap gap-x-2">
            {conflict.kind === "booking" && bookingHref ? (
              <Link href={bookingHref(conflict.id)} className="text-destructive underline">
                {text.open(conflict, names)}
              </Link>
            ) : null}
            {fix ? <span className="text-muted-foreground">{text.fix(fix)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Guest names by booking id, for naming what a selection overlaps. */
function guestNames(
  calendar: CalendarProperty | null,
  purgedName: string,
): ReadonlyMap<string, string> {
  return new Map(
    calendar?.bookings.map((b) => [b.id, guestDisplayName(b.guest.name, purgedName)]) ?? [],
  );
}

function Legend({ calendars }: { calendars: CalendarProperty[] }) {
  const t = useTranslations("calendar.month");
  const sample = calendars[0]?.property.color ?? "#0f766e";
  const swatch = "inline-block h-3 w-6 rounded-full";
  return (
    <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
      <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label={t("properties")}>
        {calendars.map(({ property }) => (
          <li key={property.id} className="flex items-center gap-1.5">
            <span className={swatch} style={{ backgroundColor: property.color }} aria-hidden />
            {property.name}
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label={t("status")}>
        <li className="flex items-center gap-1.5">
          <span className={swatch} style={{ backgroundColor: sample }} aria-hidden />
          {t("legendConfirmed")}
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
          {t("legendInquiry")}
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
          {t("blocked")}
        </li>
      </ul>
    </div>
  );
}
