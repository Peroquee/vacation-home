"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useFormat } from "@/i18n/use-format";
import type { BookingStatus } from "@/lib/bookings/values";
import { guestDisplayName } from "@/lib/guests/display";

type Detail = {
  id: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  status: BookingStatus;
  guestCount: number;
  totalAmountMinor: number;
  currency: string;
  guest: { name: string };
  property: { name: string };
};

/**
 * A booking's essentials in a sheet beside the calendar (from the bottom on
 * a phone), with a way into the full booking. The calendar stays where it
 * was underneath.
 */
export function BookingSheet({
  bookingId,
  onClose,
}: {
  bookingId: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  const t = useTranslations();
  const format = useFormat();

  useEffect(() => {
    if (!bookingId) return;
    const controller = new AbortController();
    fetch(`/api/bookings/${bookingId}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error())))
      .then((body: Detail) => {
        setDetail(body);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [bookingId]);

  const shown = detail?.id === bookingId ? detail : null;
  return (
    <Sheet open={bookingId !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {shown
              ? guestDisplayName(shown.guest.name, t("guests.purgedName"))
              : t("bookings.detail.title")}
          </SheetTitle>
          <SheetDescription>
            {shown
              ? `${shown.property.name} · ${t(`bookings.status.${shown.status}`)}`
              : failed
                ? t("calendar.sheet.loadFailed")
                : t("calendar.sheet.loading")}
          </SheetDescription>
        </SheetHeader>
        {shown ? (
          <div className="space-y-4 px-4 pb-4">
            <dl className="divide-y text-sm">
              {[
                [t("bookings.detail.checkIn"), format.date(shown.checkIn, { style: "full" })],
                [t("bookings.detail.checkOut"), format.date(shown.checkOut, { style: "full" })],
                [t("bookings.detail.nights"), String(shown.nights)],
                [t("bookings.detail.guests"), String(shown.guestCount)],
                [t("bookings.detail.total"), format.money(shown.totalAmountMinor, shown.currency)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 py-1.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-2">
              <Link href={`/bookings/${shown.id}`} className={buttonVariants()}>
                {t("calendar.sheet.open")}
              </Link>
              <Link
                href={`/bookings/${shown.id}/edit`}
                className={buttonVariants({ variant: "outline" })}
              >
                {t("common.edit")}
              </Link>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
