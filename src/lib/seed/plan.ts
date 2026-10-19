/**
 * The demo data, as a plan: plain objects, generated deterministically from
 * a fixed seed and a fixed window, so `npm run seed` produces the same
 * database every time. Pure - the seed script (prisma/seed.ts) writes it.
 *
 * Shaped to exercise the calendar, the booking list and the dashboard: two
 * properties, ~20 guests, ~60 bookings over 18 months - mostly confirmed,
 * with inquiries and cancellations, from every source, including same-day
 * turnovers - and a few owner and Google blocks in the gaps.
 */
import { addDays, type CalendarDate, daysBetween } from "@/lib/calendar-date";
import type { BlockSpan, BookingStatus } from "@/lib/availability/rules";
import type { ApiBookingSource } from "@/lib/bookings/schema";
import { type PriceBreakdown, priceStay } from "@/lib/pricing/engine";

import { createRandom } from "./random";

export const SEED = 20_260_701;
/** Eighteen months, fixed rather than relative to today, so output never drifts. */
export const WINDOW = { start: "2025-10-01", end: "2027-04-01" } as const;

export type PlannedProperty = {
  key: string;
  name: string;
  address: string;
  timezone: string;
  currency: string;
  defaultNightlyRateMinor: number;
  defaultCleaningFeeMinor: number;
  color: string;
};
export type PlannedGuest = {
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
};
export type PlannedBooking = {
  property: string;
  guest: string;
  checkIn: CalendarDate;
  checkOut: CalendarDate;
  status: BookingStatus;
  source: ApiBookingSource;
  guestCount: number;
  nightlyRateMinor: number;
  cleaningFeeMinor: number;
  totalAmountMinor: number;
  priceBreakdown: PriceBreakdown;
  totalIsManual: boolean;
  currency: string;
  notes: string | null;
};
export type PlannedBlock = {
  property: string;
  startDate: CalendarDate;
  endDate: CalendarDate;
  reason: string;
  origin: BlockSpan["origin"];
  externalEventId: string | null;
};
export type SeedPlan = {
  properties: PlannedProperty[];
  guests: PlannedGuest[];
  bookings: PlannedBooking[];
  blocks: PlannedBlock[];
};

const PROPERTIES: PlannedProperty[] = [
  {
    key: "lake",
    name: "Lake House",
    address: "Rua do Lago 12, 7050-000 Montemor-o-Novo, Portugal",
    timezone: "Europe/Lisbon",
    currency: "EUR",
    defaultNightlyRateMinor: 14_500,
    defaultCleaningFeeMinor: 6_000,
    color: "#0f766e",
  },
  {
    key: "cabin",
    name: "Mountain Cabin",
    // In the eurozone like the other: the owner prices only in EUR, and the
    // dashboard cannot add up amounts in different currencies.
    address: "Bergweg 4, 6870 Bezau, Austria",
    timezone: "Europe/Vienna",
    currency: "EUR",
    defaultNightlyRateMinor: 18_000,
    defaultCleaningFeeMinor: 8_000,
    color: "#7c3aed",
  },
];

// Invented people; the addresses use the reserved .test domain.
const FIRST = ["Ana", "Ben", "Clara", "David", "Elena", "Felix", "Greta", "Hugo", "Inês", "Jonas"];
const LAST = ["Almeida", "Brandt", "Costa", "Dubois", "Eriksen", "Fischer", "García", "Hansen"];

const SOURCES: readonly (readonly [ApiBookingSource, number])[] = [
  ["direct", 3],
  ["airbnb", 4],
  ["booking.com", 3],
  ["other", 1],
];
const NOTES = [
  null,
  null,
  null,
  "Arriving late",
  "Travelling with a dog",
  "Early check-in asked",
  "Cot needed",
];

export function buildSeedPlan(seed = SEED): SeedPlan {
  const random = createRandom(seed);

  const guests: PlannedGuest[] = Array.from({ length: 20 }, (_, i) => {
    const first = FIRST[i % FIRST.length]!;
    const last = LAST[(i * 3) % LAST.length]!;
    const slug = `${first}.${last}`
      .toLowerCase()
      .normalize("NFD")
      .replace(/[^a-z.]/g, "");
    return {
      key: `guest-${i + 1}`,
      name: `${first} ${last}`,
      // A few walk-ins leave no email, to exercise the optional field.
      email: i % 7 === 6 ? null : `${slug}${i + 1}@example.test`,
      phone:
        random.next() < 0.6
          ? `+351 9${random.int(10, 99)} ${random.int(100, 999)} ${random.int(100, 999)}`
          : null,
    };
  });

  const bookings: PlannedBooking[] = [];
  const blocks: PlannedBlock[] = [];

  for (const property of PROPERTIES) {
    // Walk the window, alternating stays and gaps; occasionally a gap of zero
    // (a same-day turnover) and occasionally a block instead of a stay.
    let cursor: CalendarDate = addDays(WINDOW.start, random.int(0, 6));
    let googleEvents = 0;

    while (daysBetween(cursor, WINDOW.end) > 3) {
      const roll = random.next();

      if (roll < 0.08) {
        // Kept inside the window, like every stay.
        const length = Math.min(random.int(2, 6), daysBetween(cursor, WINDOW.end));
        const fromGoogle = googleEvents < 2 && random.next() < 0.5;
        if (fromGoogle) googleEvents++;
        blocks.push({
          property: property.key,
          startDate: cursor,
          endDate: addDays(cursor, length),
          reason: fromGoogle
            ? "Family visit (from Google Calendar)"
            : random.pick(["Painting", "Boiler service", "Owner stay"]),
          origin: fromGoogle ? "google" : "manual",
          externalEventId: fromGoogle ? `seed-${property.key}-${googleEvents}` : null,
        });
        cursor = addDays(cursor, length + random.int(1, 5));
        continue;
      }

      const nights = random.int(2, 9);
      const checkOut = addDays(cursor, nights);
      if (daysBetween(checkOut, WINDOW.end) < 0) break;

      const status = random.weighted([
        ["confirmed", 8],
        ["cancelled", 1],
        ["inquiry", 1],
      ] as const);
      // Rates drift a little around the default, as real prices do.
      const nightlyRateMinor = property.defaultNightlyRateMinor + random.int(-3, 6) * 500;
      const stay = { checkIn: cursor, checkOut };
      const manual = random.next() < 0.05;
      // The engine's price (GitLab #118), at the booking's own rate.
      const priceBreakdown = priceStay(
        {
          currency: property.currency,
          defaultNightlyRateMinor: property.defaultNightlyRateMinor,
          defaultCleaningFeeMinor: property.defaultCleaningFeeMinor,
          seasons: [],
          discounts: [],
          touristTax: null,
        },
        { ...stay, nightlyRateMinor, cleaningFeeMinor: property.defaultCleaningFeeMinor },
      );
      const calculated = priceBreakdown.totalMinor;

      bookings.push({
        property: property.key,
        guest: random.pick(guests).key,
        ...stay,
        status,
        source: random.weighted(SOURCES),
        guestCount: random.int(1, 6),
        nightlyRateMinor,
        cleaningFeeMinor: property.defaultCleaningFeeMinor,
        // Now and then a negotiated total, set by hand.
        totalAmountMinor: manual ? Math.round(calculated * 0.9) : calculated,
        priceBreakdown,
        totalIsManual: manual,
        currency: property.currency,
        notes: random.pick(NOTES),
      });

      // Cancelled and inquiry stays do not occupy the dates: the next stay
      // may begin inside them. Confirmed ones are followed by a gap - or none.
      cursor =
        status === "confirmed"
          ? addDays(checkOut, random.next() < 0.15 ? 0 : random.int(8, 30))
          : addDays(cursor, random.int(1, nights));
    }
  }

  return { properties: PROPERTIES, guests, bookings, blocks };
}
