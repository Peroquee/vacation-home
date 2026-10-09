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

  return { describe, fix };
}
