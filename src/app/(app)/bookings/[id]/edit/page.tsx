import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { isUuid } from "@/lib/api";
import { toPropertyChoice } from "@/lib/bookings/form";
import { getBooking, toDto } from "@/lib/bookings/service";
import { formatDateRange } from "@/lib/format";
import { getGuest } from "@/lib/guests/service";
import { listProperties } from "@/lib/properties/service";

import { BookingForm } from "../../booking-form";

export const metadata: Metadata = { title: "Edit booking" };

export default async function EditBookingPage({ params }: PageProps<"/bookings/[id]/edit">) {
  const { id } = await params;
  // Looked up before anything streams, so a missing booking is a real 404.
  const booking = isUuid(id) ? await getBooking(id) : null;
  if (!booking) notFound();

  const [guest, all] = await Promise.all([
    getGuest(booking.guestId),
    listProperties({ includeArchived: true }),
  ]);
  // Its own property stays listed even if archived since; the selector is
  // read-only when editing anyway.
  const properties = all
    .filter((p) => p.archivedAt === null || p.id === booking.propertyId)
    .map(toPropertyChoice);
  const dto = toDto(booking);

  return (
    <>
      <PageHeader
        title={`Edit booking: ${dto.guest.name}`}
        description={`${dto.property.name}, ${formatDateRange(dto.checkIn, dto.checkOut)}`}
      />
      <BookingForm
        properties={properties}
        booking={{ ...dto, guest: { ...dto.guest, email: guest?.email ?? null } }}
      />
    </>
  );
}
