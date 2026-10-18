/**
 * The public calendar's data for a listed property (GitLab #108).
 * Server-side only. Built from the same cached calendar windows the owner's
 * calendar uses, reduced to free/unavailable per night: no ids, no guests,
 * no reasons. Pending requests (inquiries) do not take nights.
 */
import type { Property } from "@/generated/prisma/client";
import { getCalendars } from "@/lib/availability/calendar";
import { addDays, type CalendarDate } from "@/lib/calendar-date";
import { todayIn } from "@/lib/finance/recurring";
import type { PricingRules } from "@/lib/pricing/engine";
import { pricingRulesFor } from "@/lib/pricing/service";

import { type PublicNight, publicNights } from "./public-nights";
import { getBookingRules } from "./service";

export type PublicAvailability = {
  from: CalendarDate;
  to: CalendarDate;
  /** For the picker: the stay lengths allowed. */
  minNights: number;
  maxNights: number | null;
  /**
   * For the estimate: the rules a booking's total is worked out by, for the
   * same engine in the browser (GitLab #118). Season names and rates are
   * meant for guests; nothing else of the owner's is in them.
   */
  pricing: PricingRules;
  nights: PublicNight[];
};

export async function getPublicAvailability(
  property: Pick<
    Property,
    "id" | "timezone" | "currency" | "defaultNightlyRateMinor" | "defaultCleaningFeeMinor"
  >,
  { from, to }: { from: CalendarDate; to: CalendarDate },
  now = new Date(),
): Promise<PublicAvailability> {
  const [rules, pricing] = await Promise.all([
    getBookingRules(property.id),
    pricingRulesFor(property),
  ]);
  // Whatever can affect a night in the window: the buffer on either side,
  // and the shortest stay starting on its last day.
  const range = {
    start: addDays(from, -rules.bufferDays),
    end: addDays(to, rules.minNights + rules.bufferDays),
  };
  const { calendars } = await getCalendars([property.id], range);
  const taken = new Set(
    (calendars[0]?.days ?? [])
      .filter((day) => day.status === "booked" || day.status === "blocked")
      .map((day) => day.date),
  );
  return {
    from,
    to,
    minNights: rules.minNights,
    maxNights: rules.maxNights,
    pricing,
    nights: publicNights({ from, to }, taken, rules, todayIn(property.timezone, now)),
  };
}
