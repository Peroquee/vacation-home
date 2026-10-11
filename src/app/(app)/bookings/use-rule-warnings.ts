"use client";

import { useEffect, useState } from "react";

import type { RuleViolation } from "@/lib/booking-rules/rules";
import { stayNights } from "@/lib/bookings/form";

/**
 * The property's booking rules (GitLab #107) a stay breaks, as the dates
 * change: the same check the public site refuses with, here only a warning,
 * since the owner may make exceptions. Debounced; stale answers are dropped,
 * and a failed check shows nothing rather than a false alarm.
 */
export function useRuleWarnings(
  propertyId: string,
  checkIn: string,
  checkOut: string,
  ignoreBookingId?: string,
): RuleViolation[] {
  const [answer, setAnswer] = useState<{ key: string; warnings: RuleViolation[] } | null>(null);
  const key =
    propertyId !== "" && stayNights(checkIn, checkOut) !== null
      ? `${propertyId}|${checkIn}|${checkOut}|${ignoreBookingId ?? ""}`
      : null;

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ checkIn, checkOut });
        if (ignoreBookingId) params.set("ignoreBookingId", ignoreBookingId);
        const response = await fetch(
          `/api/properties/${propertyId}/booking-rules/check?${params}`,
          {
            signal: controller.signal,
          },
        );
        if (!response.ok) return;
        const body: { warnings: RuleViolation[] } = await response.json();
        if (!controller.signal.aborted) setAnswer({ key, warnings: body.warnings });
      } catch {
        // Aborted, or offline: no warning is better than a wrong one.
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, propertyId, checkIn, checkOut, ignoreBookingId]);

  return key !== null && answer?.key === key ? answer.warnings : [];
}
