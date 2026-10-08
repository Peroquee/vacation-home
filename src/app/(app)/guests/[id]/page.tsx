import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { type Column, DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isUuid } from "@/lib/api";
import { STATUS_LABELS } from "@/lib/bookings/labels";
import { type BookingDto, listGuestBookings, toDto } from "@/lib/bookings/service";
import { formatDate, formatDateRange, formatMoney } from "@/lib/format";
import { getGuest } from "@/lib/guests/service";

import { EraseGuestButton } from "./erase-guest-button";

export const metadata: Metadata = { title: "Guest" };

const columns: Column<BookingDto>[] = [
  {
    id: "stay",
    header: "Stay",
    cell: (b) => (
      <Link href={`/bookings/${b.id}`} className="font-medium hover:underline">
        {formatDateRange(b.checkIn, b.checkOut)}
      </Link>
    ),
  },
  { id: "property", header: "Property", cell: (b) => b.property.name },
  { id: "status", header: "Status", cell: (b) => STATUS_LABELS[b.status] },
  {
    id: "total",
    header: "Total",
    cell: (b) => formatMoney(b.totalAmountMinor, b.currency),
    align: "end",
  },
];

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

/**
 * One guest: contact details, their stays, and the DSGVO erasure. Read-only
 * otherwise; an erased guest shows only the anonymised record.
 */
export default async function GuestPage({ params }: PageProps<"/guests/[id]">) {
  const { id } = await params;
  // Looked up before anything streams, so a missing guest is a real 404.
  const guest = isUuid(id) ? await getGuest(id) : null;
  if (!guest) notFound();

  const bookings = (await listGuestBookings(guest.id)).map(toDto);
  const purged = guest.purgedAt !== null;

  return (
    <>
      <PageHeader
        title={guest.name}
        description={purged ? "Personal data erased." : undefined}
        actions={purged ? null : <EraseGuestButton id={guest.id} name={guest.name} />}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent>
            {purged ? (
              <p className="text-muted-foreground text-sm">
                Erased on {formatDate(guest.purgedAt!.toISOString().slice(0, 10))}. Only the
                anonymised bookings remain.
              </p>
            ) : (
              <dl className="divide-y text-sm">
                <Fact label="Email">
                  {guest.email ? (
                    <a href={`mailto:${guest.email}`} className="underline">
                      {guest.email}
                    </a>
                  ) : (
                    "–"
                  )}
                </Fact>
                <Fact label="Phone">
                  {guest.phone ? (
                    <a href={`tel:${guest.phone.replace(/[^0-9+]/g, "")}`} className="underline">
                      {guest.phone}
                    </a>
                  ) : (
                    "–"
                  )}
                </Fact>
                {guest.notes ? (
                  <Fact label="Notes">
                    <span className="whitespace-pre-wrap">{guest.notes}</span>
                  </Fact>
                ) : null}
              </dl>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Stays</CardTitle>
            <CardDescription>
              {bookings.length} {bookings.length === 1 ? "booking" : "bookings"}, newest first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              caption={`Bookings of ${guest.name}`}
              columns={columns}
              rows={bookings}
              rowKey={(b) => b.id}
              empty={<EmptyState title="No bookings" description="This guest has no stays yet." />}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
