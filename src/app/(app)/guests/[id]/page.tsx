import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { type Column, DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isUuid } from "@/lib/api";
import { type Formatters } from "@/i18n/format";
import { getFormat } from "@/i18n/get-format";
import { type BookingDto, listGuestBookings, toDto } from "@/lib/bookings/service";
import { guestDisplayName } from "@/lib/guests/display";
import { getGuest } from "@/lib/guests/service";

import { EraseGuestButton } from "./erase-guest-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("guests");
  return { title: t("title") };
}

type Translate = Awaited<ReturnType<typeof getTranslations<never>>>;

function columnsFor(t: Translate, format: Formatters): Column<BookingDto>[] {
  return [
    {
      id: "stay",
      header: t("guests.columns.stay"),
      cell: (b) => (
        <Link href={`/bookings/${b.id}`} className="font-medium hover:underline">
          {format.dateRange(b.checkIn, b.checkOut)}
        </Link>
      ),
    },
    { id: "property", header: t("guests.columns.property"), cell: (b) => b.property.name },
    {
      id: "status",
      header: t("guests.columns.status"),
      cell: (b) => t(`bookings.status.${b.status}`),
    },
    {
      id: "total",
      header: t("guests.columns.total"),
      cell: (b) => format.money(b.totalAmountMinor, b.currency),
      align: "end",
    },
  ];
}

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
  const t = await getTranslations();
  const format = await getFormat();
  const name = guestDisplayName(guest.name, t("guests.purgedName"));

  return (
    <>
      <PageHeader
        title={name}
        description={purged ? t("guests.erasedShort") : undefined}
        actions={purged ? null : <EraseGuestButton id={guest.id} name={guest.name} />}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("guests.contact")}</CardTitle>
          </CardHeader>
          <CardContent>
            {purged ? (
              <p className="text-muted-foreground text-sm">
                {t("guests.erasedOn", {
                  date: format.date(guest.purgedAt!.toISOString().slice(0, 10)),
                })}
              </p>
            ) : (
              <dl className="divide-y text-sm">
                <Fact label={t("guests.email")}>
                  {guest.email ? (
                    <a href={`mailto:${guest.email}`} className="underline">
                      {guest.email}
                    </a>
                  ) : (
                    "–"
                  )}
                </Fact>
                <Fact label={t("guests.phone")}>
                  {guest.phone ? (
                    <a href={`tel:${guest.phone.replace(/[^0-9+]/g, "")}`} className="underline">
                      {guest.phone}
                    </a>
                  ) : (
                    "–"
                  )}
                </Fact>
                {guest.notes ? (
                  <Fact label={t("guests.notes")}>
                    <span className="whitespace-pre-wrap">{guest.notes}</span>
                  </Fact>
                ) : null}
              </dl>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{t("guests.stays")}</CardTitle>
            <CardDescription>{t("guests.staysCount", { count: bookings.length })}</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              caption={t("guests.bookingsOf", { name })}
              columns={columnsFor(t, format)}
              rows={bookings}
              rowKey={(b) => b.id}
              empty={
                <EmptyState title={t("guests.noBookings")} description={t("guests.noStays")} />
              }
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
