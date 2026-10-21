/**
 * The guest's stay as a calendar entry (GitLab #125): for the confirmation
 * emails, and for the download under the guest's page, which opens exactly
 * as the page does - the same token, nothing else - and is written on
 * request, never stored. Server-side only.
 */
import { createTranslator } from "next-intl";

import { env } from "@/env";
import type { Locale } from "@/i18n/locales";
import { fromUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";
import { bookingStayTimes } from "@/lib/listing/service";
import { describeStayTimes, type StayTimes } from "@/lib/listing/stay-times";
import { bookingForToken, guestPath } from "@/lib/payments/guest-link";

import { type StayEvent, stayEventWords } from "./stay-event";

import de from "../../../messages/de-DE.json";
import en from "../../../messages/en-GB.json";

const MESSAGES = { "de-DE": de, "en-GB": en } as const;

/** A translator over `namespace` in `locale`, for the pure helpers. */
function translator(locale: Locale, namespace: "stayCalendar" | "stayTimes") {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace });
  return (key: string, values?: Record<string, string>) =>
    t(key as Parameters<typeof t>[0], values);
}

export type StaySource = {
  id: string;
  status: StayEvent["status"];
  reference: string | null;
  checkIn: Date;
  checkOut: Date;
  property: {
    name: string;
    timezone: string;
    listing: { titleEn: string; titleDe: string; location: string } | null;
  };
};

/**
 * A booking's calendar entry in `locale`, at `times`, linking `guestUrl`.
 * Where: the approximate location, unless `location` says otherwise (the
 * exact address, in the fully-paid email only).
 */
export function stayEventOf(
  booking: StaySource,
  stay: { times: StayTimes; locale: Locale; guestUrl: string; version: Date; location?: string },
): StayEvent {
  const listing = booking.property.listing;
  const pick = (text: { en: string; de: string }) =>
    stay.locale.startsWith("de") ? text.de || text.en : text.en || text.de;
  const title =
    listing && (listing.titleEn || listing.titleDe)
      ? pick({ en: listing.titleEn, de: listing.titleDe })
      : booking.property.name;
  return {
    bookingId: booking.id,
    status: booking.status,
    checkIn: fromUtcDate(booking.checkIn),
    checkOut: fromUtcDate(booking.checkOut),
    times: stay.times,
    timezone: booking.property.timezone,
    version: stay.version,
    ...stayEventWords(translator(stay.locale, "stayCalendar"), {
      title,
      reference: booking.reference,
      times: describeStayTimes(translator(stay.locale, "stayTimes"), stay.times),
      guestUrl: stay.guestUrl,
    }),
    location: stay.location ?? listing?.location ?? "",
    guestUrl: stay.guestUrl,
  };
}

/** The stay a guest link's token opens, as a calendar entry, or null. */
export async function guestStayEvent(token: string, locale: Locale): Promise<StayEvent | null> {
  const bookingId = await bookingForToken(token);
  if (!bookingId) return null;
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      propertyId: true,
      status: true,
      reference: true,
      checkIn: true,
      checkOut: true,
      updatedAt: true,
      stayTimes: true,
      property: {
        select: {
          name: true,
          timezone: true,
          listing: { select: { titleEn: true, titleDe: true, location: true } },
        },
      },
    },
  });
  if (!booking) return null;
  return stayEventOf(booking, {
    times: await bookingStayTimes(booking),
    locale,
    guestUrl: new URL(guestPath(token), env.APP_URL).toString(),
    version: booking.updatedAt,
  });
}
