import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { isUuid } from "@/lib/api";
import { toPropertyChoice } from "@/lib/bookings/form";
import { pricingRulesForMany } from "@/lib/pricing/service";
import { getBooking, toDto } from "@/lib/bookings/service";
import { getFormat } from "@/i18n/get-format";
import { guestDisplayName } from "@/lib/guests/display";
import { getGuest } from "@/lib/guests/service";
import { listProperties } from "@/lib/properties/service";

import { BookingForm } from "../../booking-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("bookings.edit");
  return { title: t("title") };
}

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
  const shown = all.filter((p) => p.archivedAt === null || p.id === booking.propertyId);
  const pricing = await pricingRulesForMany(shown);
  const properties = shown.map((p) => toPropertyChoice(p, pricing.get(p.id)));
  const dto = toDto(booking);
  const t = await getTranslations("bookings.edit");
  const tGuests = await getTranslations("guests");
  const format = await getFormat();

  return (
    <>
      <PageHeader
        title={t("titleFor", { name: guestDisplayName(dto.guest.name, tGuests("purgedName")) })}
        description={`${dto.property.name}, ${format.dateRange(dto.checkIn, dto.checkOut)}`}
      />
      <BookingForm
        properties={properties}
        booking={{ ...dto, guest: { ...dto.guest, email: guest?.email ?? null } }}
      />
    </>
  );
}
