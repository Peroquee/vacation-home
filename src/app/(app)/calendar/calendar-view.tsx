"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  type CalendarProperty,
  MonthCalendar,
  type MonthCalendarProps,
  PENDING_PREFIX,
} from "@/components/calendar/month-calendar";
import { toastError, toastSuccess } from "@/components/toast";
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
import type { CalendarBlock } from "@/lib/availability/calendar";
import { type Conflict, describeConflict } from "@/lib/bookings/form";
import type { CalendarDate } from "@/lib/calendar-date";
import { formatDateRange } from "@/lib/format";

import { BlockDialog, type EditableBlock } from "./block-dialog";

type Range = { propertyId: string; checkIn: CalendarDate; checkOut: CalendarDate };

/** A block on screen before the server has it. */
type PendingBlock = CalendarBlock & { propertyId: string };

let pendingCount = 0;

/**
 * The calendar page's state around the controlled MonthCalendar: the month
 * lives in the URL, so a reload or a shared link shows the same month. A
 * selected free range offers a new booking or a block. A new block shows at
 * once and is rolled back if the server refuses it, which then rings the
 * bookings in the way; blocks open an editor when clicked.
 */
export function CalendarView(
  props: Omit<
    MonthCalendarProps,
    "onMonthChange" | "bookingHref" | "onSelectRange" | "onBlockClick" | "highlight"
  >,
) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<Range | null>(null);
  const [optimistic, setOptimistic] = useState<PendingBlock[]>([]);
  const [refusal, setRefusal] = useState<{ range: Range; conflicts: Conflict[] } | null>(null);
  const [editing, setEditing] = useState<EditableBlock | null>(null);

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
    () => new Map(props.calendars.flatMap((c) => c.bookings.map((b) => [b.id, b.guest.name]))),
    [props.calendars],
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
      toastSuccess("Dates blocked");
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
      toastError(
        new Error(body?.error?.message ?? "The server could not be reached."),
        "Could not block the dates",
      );
    }
  }

  return (
    <>
      {refusal ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive mb-3 rounded-lg border p-3 text-sm"
        >
          <p className="font-medium">
            {formatDateRange(refusal.range.checkIn, refusal.range.checkOut)} could not be blocked: a
            confirmed booking is in the way.
          </p>
          <ul className="mt-1 list-disc pl-5">
            {refusal.conflicts.map((conflict) => (
              <li key={`${conflict.kind}-${conflict.id}`}>
                {conflict.kind === "booking" ? (
                  <Link href={`/bookings/${conflict.id}`} className="underline">
                    Open: {describeConflict(conflict, names)}
                  </Link>
                ) : (
                  describeConflict(conflict, names)
                )}
              </li>
            ))}
          </ul>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => setRefusal(null)}>
            Dismiss
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
          startTransition(() => router.push(`/calendar?month=${month}`, { scroll: false }))
        }
        onSelectRange={(range) => {
          setRefusal(null);
          setChoice(range);
        }}
        onBlockClick={setEditing}
      />

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
              <DialogTitle>{formatDateRange(range.checkIn, range.checkOut)}</DialogTitle>
              <DialogDescription>
                {propertyName ? `${propertyName}: ` : ""}book these dates for a guest, or block them
                for yourself.
              </DialogDescription>
            </DialogHeader>
            <Link href={`/bookings/new?${new URLSearchParams(range)}`} className={buttonVariants()}>
              New booking
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
                <FieldLabel htmlFor="block-reason">Reason (optional)</FieldLabel>
                <Input
                  id="block-reason"
                  value={reason}
                  maxLength={200}
                  placeholder="Maintenance, family visit…"
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
              <Button type="submit" variant="outline">
                Block dates
              </Button>
            </form>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
