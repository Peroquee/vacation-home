"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";

import { Agenda } from "@/components/calendar/agenda";
import {
  type CalendarProperty,
  MonthCalendar,
  type MonthCalendarProps,
  PENDING_PREFIX,
} from "@/components/calendar/month-calendar";
import { toastError, toastSuccess } from "@/components/toast";
import { useConflictText } from "@/components/use-conflict-text";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { CalendarBlock } from "@/lib/availability/calendar";
import { type Conflict } from "@/lib/bookings/form";
import { type AgendaItem, agendaItems, monthWindow } from "@/lib/calendar/agenda";
import { addMonths } from "@/lib/calendar/month";
import type { CalendarDate } from "@/lib/calendar-date";
import {
  CALENDAR_PROPERTY_COOKIE,
  choiceCookie,
  type PropertyChoice,
} from "@/lib/calendar/property-choice";
import { useApiText } from "@/i18n/use-api-text";
import { useFormat } from "@/i18n/use-format";
import { guestDisplayName } from "@/lib/guests/display";

import { BlockDialog, type EditableBlock } from "./block-dialog";
import { BookingSheet } from "./booking-sheet";

type Range = { propertyId: string; checkIn: CalendarDate; checkOut: CalendarDate };

/** A block on screen before the server has it. */
type PendingBlock = CalendarBlock & { propertyId: string };

let pendingCount = 0;

/** The calendar's URL for a month and a property choice, both explicit so a link is stable. */
function calendarHref(month: string, choice: PropertyChoice): string {
  const params = new URLSearchParams({ month, property: choice });
  return `/calendar?${params}`;
}

/**
 * The calendar page's state around the controlled MonthCalendar: the month
 * lives in the URL, so a reload or a shared link shows the same month. A
 * selected free range offers a new booking or a block. A new block shows at
 * once and is rolled back if the server refuses it, which then rings the
 * bookings in the way; blocks open an editor when clicked.
 */
export function CalendarView({
  propertyChoice,
  userId,
  properties,
  ...props
}: Omit<
  MonthCalendarProps,
  "onMonthChange" | "bookingHref" | "onSelectRange" | "onBlockClick" | "highlight"
> & {
  /** One property's id, or "all" for the combined view. */
  propertyChoice: PropertyChoice;
  /** Whose choice to remember; null leaves it unremembered. */
  userId: string | null;
  /** The properties to choose from; empty hides the selector (one property). */
  properties: { id: string; name: string }[];
}) {
  const router = useRouter();
  const t = useTranslations("calendar.view");
  const purgedName = useTranslations("guests")("purgedName");
  const format = useFormat();
  const conflictText = useConflictText();
  const api = useApiText();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<Range | null>(null);
  const [optimistic, setOptimistic] = useState<PendingBlock[]>([]);
  const [refusal, setRefusal] = useState<{ range: Range; conflicts: Conflict[] } | null>(null);
  const [editing, setEditing] = useState<EditableBlock | null>(null);
  const [sheetBooking, setSheetBooking] = useState<string | null>(null);

  const calendars: CalendarProperty[] = useMemo(
    () =>
      props.calendars.map((calendar) => ({
        ...calendar,
        blocks: [
          ...calendar.blocks,
          ...optimistic.filter((b) => b.propertyId === calendar.property.id),
        ],
      })),
    [props.calendars, optimistic],
  );
  const names = useMemo(
    () =>
      new Map(
        props.calendars.flatMap((c) =>
          c.bookings.map((b) => [b.id, guestDisplayName(b.guest.name, purgedName)]),
        ),
      ),
    [props.calendars, purgedName],
  );

  function reload() {
    startTransition(() => router.refresh());
  }

  async function block(range: Range, reason: string) {
    setChoice(null);
    setRefusal(null);
    const placeholder: PendingBlock = {
      id: `${PENDING_PREFIX}${++pendingCount}`,
      propertyId: range.propertyId,
      startDate: range.checkIn,
      endDate: range.checkOut,
      reason: reason.trim() || null,
      origin: "manual",
    };
    const without = (list: PendingBlock[]) => list.filter((b) => b.id !== placeholder.id);
    setOptimistic((list) => [...list, placeholder]);

    const response = await fetch("/api/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: range.propertyId,
        startDate: range.checkIn,
        endDate: range.checkOut,
        reason,
      }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);

    if (response?.ok) {
      toastSuccess(t("blocked"));
      // Swapped for the real block in the same render as the fresh data.
      startTransition(() => {
        setOptimistic(without);
        router.refresh();
      });
      return;
    }
    // Refused: nothing that was never saved stays on the calendar.
    setOptimistic(without);
    if (response?.status === 409 && body?.error?.conflicts?.length) {
      setRefusal({ range, conflicts: body.error.conflicts });
    } else {
      toastError(new Error(api.message(body) ?? t("unreachable")), t("blockFailed"));
    }
  }

  function chooseProperty(next: PropertyChoice) {
    if (userId) {
      // Remembered for a year, for this user only.
      document.cookie = `${CALENDAR_PROPERTY_COOKIE}=${encodeURIComponent(
        choiceCookie(userId, next),
      )}; path=/; max-age=31536000; samesite=lax`;
    }
    setRefusal(null);
    startTransition(() => router.push(calendarHref(props.month, next), { scroll: false }));
  }

  return (
    <>
      {properties.length > 0 ? (
        <div className="mb-3 flex items-center gap-2">
          <label htmlFor="calendar-property" className="text-sm font-medium">
            {t("show")}
          </label>
          <NativeSelect
            id="calendar-property"
            value={propertyChoice}
            onChange={(event) => chooseProperty(event.target.value)}
          >
            <NativeSelectOption value="all">{t("allProperties")}</NativeSelectOption>
            {properties.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      ) : null}

      {refusal ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive mb-3 rounded-lg border p-3 text-sm"
        >
          <p className="font-medium">
            {t("refused", {
              range: format.dateRange(refusal.range.checkIn, refusal.range.checkOut),
            })}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {refusal.conflicts.map((conflict) => (
              <li key={`${conflict.kind}-${conflict.id}`}>
                {conflict.kind === "booking" ? (
                  <Link href={`/bookings/${conflict.id}`} className="underline">
                    {t("open", { conflict: conflictText.describe(conflict, names) })}
                  </Link>
                ) : (
                  conflictText.describe(conflict, names)
                )}
              </li>
            ))}
          </ul>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => setRefusal(null)}>
            {t("dismiss")}
          </Button>
        </div>
      ) : null}

      <MonthCalendar
        {...props}
        calendars={calendars}
        pending={pending}
        bookingHref={(id) => `/bookings/${id}`}
        highlight={refusal?.conflicts.map((c) => `${c.kind === "booking" ? "b" : "k"}-${c.id}`)}
        onMonthChange={(month) =>
          startTransition(() => router.push(calendarHref(month, propertyChoice), { scroll: false }))
        }
        onSelectRange={(range) => {
          setRefusal(null);
          setChoice(range);
        }}
        onBlockClick={setEditing}
      />

      {/* Below the tablet breakpoint the month grid gets an agenda list underneath. */}
      <AgendaPanel
        key={`${props.month}-${propertyChoice}`}
        month={props.month}
        calendars={calendars}
        onOpen={(item) =>
          item.kind === "booking"
            ? setSheetBooking(item.booking.id)
            : setEditing({ ...item.block, propertyId: item.property.id })
        }
      />
      <BookingSheet bookingId={sheetBooking} onClose={() => setSheetBooking(null)} />

      <RangeChoice
        range={choice}
        propertyName={
          props.calendars.find((c) => c.property.id === choice?.propertyId)?.property.name
        }
        onClose={() => setChoice(null)}
        onBlock={block}
      />
      <BlockDialog block={editing} onClose={() => setEditing(null)} onChanged={reload} />
    </>
  );
}

/**
 * The agenda for phones: the month on screen, then each further month as the
 * list scrolls to its end, loaded from the availability API.
 */
function AgendaPanel({
  month,
  calendars,
  onOpen,
}: {
  month: string;
  calendars: CalendarProperty[];
  onOpen: (item: AgendaItem) => void;
}) {
  const [later, setLater] = useState<{ month: string; calendars: CalendarProperty[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const t = useTranslations("calendar.view");
  const loadingRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    const next = addMonths(later.at(-1)?.month ?? month, 1);
    const { start, end } = monthWindow(next);
    const params = new URLSearchParams({
      propertyIds: calendars.map((c) => c.property.id).join(","),
      from: start,
      to: end,
    });
    try {
      const response = await fetch(`/api/availability?${params}`);
      // Only whether it failed is shown.
      if (!response.ok) throw new Error(String(response.status));
      const body: { properties: CalendarProperty[] } = await response.json();
      setLater((list) => [...list, { month: next, calendars: body.properties }]);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [calendars, later, month]);

  const months = [
    { month, items: agendaItems(month, calendars) },
    ...later.map((m) => ({ month: m.month, items: agendaItems(m.month, m.calendars) })),
  ];
  return (
    <div className="mt-6 md:hidden">
      <Agenda months={months} onOpen={onOpen} onLoadMore={loadMore} loading={loading} />
      {failed ? (
        <p role="alert" className="text-destructive mt-2 text-center text-sm">
          {t("nextFailed")}
        </p>
      ) : null}
    </div>
  );
}

/** "New booking" or "Block dates" for a selected range. */
function RangeChoice({
  range,
  propertyName,
  onClose,
  onBlock,
}: {
  range: Range | null;
  propertyName?: string;
  onClose: () => void;
  onBlock: (range: Range, reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const t = useTranslations("calendar.view");
  const format = useFormat();

  return (
    <Dialog
      open={range !== null}
      onOpenChange={(open) => {
        if (open) return;
        setReason("");
        onClose();
      }}
    >
      <DialogContent>
        {range ? (
          <>
            <DialogHeader>
              <DialogTitle>{format.dateRange(range.checkIn, range.checkOut)}</DialogTitle>
              <DialogDescription>
                {propertyName
                  ? t("choiceDescriptionFor", { property: propertyName })
                  : t("choiceDescription")}
              </DialogDescription>
            </DialogHeader>
            <Link href={`/bookings/new?${new URLSearchParams(range)}`} className={buttonVariants()}>
              {t("newBooking")}
            </Link>
            <form
              className="grid gap-3 border-t pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                onBlock(range, reason);
                setReason("");
              }}
            >
              <Field>
                <FieldLabel htmlFor="block-reason">{t("reason")}</FieldLabel>
                <Input
                  id="block-reason"
                  value={reason}
                  maxLength={200}
                  placeholder={t("reasonPlaceholder")}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
              <Button type="submit" variant="outline">
                {t("blockDates")}
              </Button>
            </form>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
