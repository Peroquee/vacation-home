import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isUuid } from "@/lib/api";
import { SOURCE_LABELS, STATUS_LABELS } from "@/lib/bookings/labels";
import { getBooking, toDto } from "@/lib/bookings/service";
import { formatDate, formatDateRange, formatMoney } from "@/lib/format";
import { getGuest } from "@/lib/guests/service";
import { cn } from "@/lib/utils";

import { BookingActions } from "./booking-actions";

export const metadata: Metadata = { title: "Booking" };

/** A label and its value, as one row of a definition list. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export default async function BookingPage({ params }: PageProps<"/bookings/[id]">) {
  const { id } = await params;
  // Looked up before anything streams, so a missing booking is a real 404.
  const record = isUuid(id) ? await getBooking(id) : null;
  if (!record) notFound();

  const booking = toDto(record);
  const guest = await getGuest(booking.guestId);
  const money = (minor: number) => formatMoney(minor, booking.currency);
  const calculated = booking.nights * booking.nightlyRateMinor + booking.cleaningFeeMinor;

  return (
    <>
      <PageHeader
        title={booking.guest.name}
        description={`${booking.property.name}, ${formatDateRange(booking.checkIn, booking.checkOut)}`}
        actions={
          <Link
            href={`/bookings/${booking.id}/edit`}
            className={buttonVariants({ variant: "outline" })}
          >
            Edit
          </Link>
        }
      />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm">
          Status:{" "}
          <span
            className={cn(
              "font-medium",
              booking.status === "cancelled" && "text-muted-foreground line-through",
            )}
          >
            {STATUS_LABELS[booking.status]}
          </span>
          {booking.status === "inquiry" ? (
            <span className="text-muted-foreground"> (does not hold the dates yet)</span>
          ) : null}
        </p>
        <BookingActions id={booking.id} status={booking.status} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Stay</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              <Fact label="Property">{booking.property.name}</Fact>
              <Fact label="Check-in">{formatDate(booking.checkIn, { style: "full" })}</Fact>
              <Fact label="Check-out">{formatDate(booking.checkOut, { style: "full" })}</Fact>
              <Fact label="Nights">{booking.nights}</Fact>
              <Fact label="Guests">{booking.guestCount}</Fact>
              <Fact label="Source">{SOURCE_LABELS[booking.source]}</Fact>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Guest</CardTitle>
          </CardHeader>
          <CardContent>
            {guest?.purgedAt ? (
              <p className="text-muted-foreground text-sm">
                This guest&apos;s personal data was erased.
              </p>
            ) : (
              <dl className="divide-y text-sm">
                <Fact label="Name">{booking.guest.name}</Fact>
                <Fact label="Email">
                  {guest?.email ? (
                    <a href={`mailto:${guest.email}`} className="underline">
                      {guest.email}
                    </a>
                  ) : (
                    "–"
                  )}
                </Fact>
                <Fact label="Phone">
                  {guest?.phone ? (
                    <a href={`tel:${guest.phone.replace(/[^0-9+]/g, "")}`} className="underline">
                      {guest.phone}
                    </a>
                  ) : (
                    "–"
                  )}
                </Fact>
              </dl>
            )}
            <Link
              href={`/guests/${booking.guestId}`}
              className={cn(buttonVariants({ variant: "link" }), "mt-2 px-0")}
            >
              All about this guest
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Price</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              <Fact label={`${booking.nights} × ${money(booking.nightlyRateMinor)}`}>
                {money(booking.nights * booking.nightlyRateMinor)}
              </Fact>
              <Fact label="Cleaning fee">{money(booking.cleaningFeeMinor)}</Fact>
              <Fact label="Total">
                <span className="font-medium tabular-nums">{money(booking.totalAmountMinor)}</span>
              </Fact>
            </dl>
            {booking.totalIsManual ? (
              <p className="text-muted-foreground mt-2 text-sm">
                The total was set by hand
                {calculated !== booking.totalAmountMinor
                  ? `; the rates would give ${money(calculated)}`
                  : ""}
                .
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            {booking.notes ? (
              <p className="text-sm whitespace-pre-wrap">{booking.notes}</p>
            ) : (
              <p className="text-muted-foreground text-sm">No notes.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
