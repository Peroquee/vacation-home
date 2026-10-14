"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { useFormat } from "@/i18n/use-format";
import type { Conflict, TurnoverFix } from "@/lib/bookings/form";

/**
 * Words for what is in a stay's way, in the page's language:
 * `describe` gives "Booked by Ada Lovelace, 10–15 Jul 2026" or
 * "Blocked (Painting), …"; `fix` explains a turnoverFix suggestion.
 */
export function useConflictText() {
  const t = useTranslations("conflicts");
  const format = useFormat();

  const describe = useCallback(
    (conflict: Conflict, guestNames: ReadonlyMap<string, string> = new Map()) => {
      const when = format.dateRange(conflict.start, conflict.end);
      if (conflict.kind === "booking") {
        const guest = guestNames.get(conflict.id);
        return guest ? t("bookedBy", { guest, when }) : t("booked", { when });
      }
      const why = conflict.reason ?? (conflict.origin === "google" ? t("google") : null);
      return why ? t("blockedWhy", { why, when }) : t("blocked", { when });
    },
    [t, format],
  );

  const fix = useCallback(
    ({ move, to }: TurnoverFix) =>
      t(move === "checkIn" ? "arriveInstead" : "leaveInstead", {
        day: format.date(to, { style: "long" }),
      }),
    [t, format],
  );

  /** A link's text for opening the booking in the way. */
  const open = useCallback(
    (conflict: Conflict, guestNames: ReadonlyMap<string, string> = new Map()) => {
      const when = format.dateRange(conflict.start, conflict.end);
      const guest = guestNames.get(conflict.id);
      return guest ? t("openBookingOf", { guest, when }) : t("openBooking", { when });
    },
    [t, format],
  );

  return { describe, fix, open };
}

/**
 * The guests of the bookings in the way, by booking id, for `describe`:
 * the owner's API refuses with the dates only, so the names are looked up
 * here (signed in; the public site never gets them). A booking that cannot
 * be read is simply left unnamed.
 */
export async function conflictGuestNames(conflicts: Conflict[]): Promise<Map<string, string>> {
  const ids = [...new Set(conflicts.filter((c) => c.kind === "booking").map((c) => c.id))];
  const named = await Promise.all(
    ids.map(async (id) => {
      try {
        const response = await fetch(`/api/bookings/${id}`);
        if (!response.ok) return null;
        const booking = (await response.json()) as { guest?: { name?: unknown } };
        return typeof booking.guest?.name === "string" ? ([id, booking.guest.name] as const) : null;
      } catch {
        return null;
      }
    }),
  );
  return new Map(named.filter((entry) => entry !== null));
}
