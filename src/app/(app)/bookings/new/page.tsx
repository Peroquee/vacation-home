import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { toPropertyChoice } from "@/lib/bookings/form";
import { isCalendarDate } from "@/lib/calendar-date";
import { listProperties } from "@/lib/properties/service";

import { BookingForm } from "../booking-form";

export const metadata: Metadata = { title: "New booking" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * `?propertyId=&checkIn=&checkOut=` pre-fill the form, so the calendar can
 * open it for a selected range.
 */
export default async function NewBookingPage({ searchParams }: PageProps<"/bookings/new">) {
  const params = await searchParams;
  const properties = (await listProperties()).map(toPropertyChoice);
  const date = (value: string | undefined) => (value && isCalendarDate(value) ? value : undefined);

  return (
    <>
      <PageHeader title="New booking" />
      {properties.length === 0 ? (
        <EmptyState
          title="No properties yet"
          description="Add a property before taking bookings for it."
          action={
            <Link href="/settings" className={buttonVariants()}>
              Add a property
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
