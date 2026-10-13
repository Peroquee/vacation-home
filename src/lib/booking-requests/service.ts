/**
 * Booking requests from the public site (GitLab #109). Server-side only.
 *
 * A request is a booking with status `inquiry` and source `website`: the
 * owner answers it in the app (GitLab #110), and like any inquiry it holds
 * no dates. It is checked again here, at the moment it is sent, against the
 * property's booking rules and what is taken - the page the guest picked
 * the dates on may be minutes old.
 *
 * The guest is found by email or created, as the owner's own booking form
 * does (src/lib/guests/service.ts). Since that may be an existing guest,
 * the name and phone as given with this request are kept on the request
 * too, with the guest's message - all cleared by the DSGVO purge.
 */
import { randomInt } from "node:crypto";

import type { Property } from "@/generated/prisma/client";
import type { CalendarDate } from "@/lib/calendar-date";
import { violationFields } from "@/lib/booking-rules/rules";
import { checkStayAt } from "@/lib/booking-rules/service";
import { nights } from "@/lib/bookings/pricing";
import { createBooking, toDto } from "@/lib/bookings/service";
import { isPrismaError } from "@/lib/db-errors";
import { findOrCreateGuest } from "@/lib/guests/service";
import { getListing } from "@/lib/listing/service";

import type { BookingRequestInput } from "./schema";

/** Letters and digits that cannot be mistaken for each other: no I, L, O, 0, 1. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A new random reference: 8 characters, about 40 bits. */
export function newReference(): string {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

/** What the guest is told about a request sent: nothing they did not send. */
export type SentRequest = {
  reference: string;
  checkIn: CalendarDate;
  checkOut: CalendarDate;
  nights: number;
  guestCount: number;
  totalAmountMinor: number;
  currency: string;
};

export type RequestResult =
  { request: SentRequest } | { error: "invalid"; fields: Record<string, string[]> };

export async function createBookingRequest(
  property: Property,
  input: BookingRequestInput,
  now = new Date(),
): Promise<RequestResult> {
  const stay = { checkIn: input.checkIn, checkOut: input.checkOut };
  const [violations, listing] = await Promise.all([
    checkStayAt(property, stay, { mode: "public", now }),
    getListing(property.id),
  ]);
  const fields = violationFields(violations);
  if (listing.maxGuests !== null && input.guestCount > listing.maxGuests) {
    fields.guestCount = [
      listing.maxGuests === 1
        ? "this home sleeps at most 1 guest"
        : `this home sleeps at most ${listing.maxGuests} guests`,
    ];
  }
  if (Object.keys(fields).length > 0) return { error: "invalid", fields };

  const { guest } = await findOrCreateGuest({
    name: input.name,
    email: input.email,
    phone: input.phone ?? null,
  });

  // A clash of random references is all but impossible; retried all the same.
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await createBooking(
        {
          propertyId: property.id,
          guestId: guest.id,
          ...stay,
          status: "inquiry",
          source: "website",
          guestCount: input.guestCount,
        },
        {
          reference: newReference(),
          guestMessage: input.message ?? null,
          requesterName: input.name,
          requesterPhone: input.phone ?? null,
          guestLocale: input.locale,
          privacyConsentAt: now,
        },
      );
      if ("booking" in result) {
        const booking = toDto(result.booking);
        return {
          request: {
            reference: booking.reference!,
            checkIn: booking.checkIn,
            checkOut: booking.checkOut,
            nights: nights(booking.checkIn, booking.checkOut),
            guestCount: booking.guestCount,
            totalAmountMinor: booking.totalAmountMinor,
            currency: booking.currency,
          },
        };
      }
      // An inquiry takes no dates, so no conflict; the property or the
      // guest changed in the moment between (archived, erased).
      if (result.error === "invalid" && result.field === "totalAmountMinor") {
        return { error: "invalid", fields: { checkOut: [result.message] } };
      }
      throw new Error(`booking request not stored: ${result.error}`);
    } catch (error) {
      if (!(isPrismaError(error, "P2002") && attempt < 3)) throw error;
    }
  }
}
