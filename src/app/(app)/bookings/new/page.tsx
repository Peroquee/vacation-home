import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { toPropertyChoice } from "@/lib/bookings/form";
import { listSeasonsFor } from "@/lib/pricing/service";
import { isCalendarDate } from "@/lib/calendar-date";
import { listProperties } from "@/lib/properties/service";

import { BookingForm } from "../booking-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("bookings.new");
  return { title: t("title") };
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * `?propertyId=&checkIn=&checkOut=` pre-fill the form, so the calendar can
 * open it for a selected range.
 */
export default async function NewBookingPage({ searchParams }: PageProps<"/bookings/new">) {
  const params = await searchParams;
  const t = await getTranslations("bookings.new");
  const all = await listProperties();
  const seasons = await listSeasonsFor(all.map((p) => p.id));
  const properties = all.map((p) => toPropertyChoice(p, seasons.get(p.id)));
  const date = (value: string | undefined) => (value && isCalendarDate(value) ? value : undefined);

  return (
    <>
      <PageHeader title={t("title")} />
      {properties.length === 0 ? (
        <EmptyState
          title={t("noProperties")}
          description={t("noPropertiesHint")}
          action={
            <Link href="/settings" className={buttonVariants()}>
              {t("addProperty")}
            </Link>
          }
        />
      ) : (
        <BookingForm
          properties={properties}
          preset={{
            propertyId: first(params.propertyId),
            checkIn: date(first(params.checkIn)),
            checkOut: date(first(params.checkOut)),
          }}
        />
      )}
    </>
  );
}
