/**
 * The cancellation policy in words (GitLab #116, #123): one sentence for
 * every place a guest or the owner reads it - the property page, the
 * estimate, above the request's consent, the guest's page, the emails and
 * the owner's booking - with the same dates the cancel computation uses.
 * Pure and client-safe; the caller passes its translator ("cancellation")
 * and date formatter.
 */
import type { CalendarDate } from "@/lib/calendar-date";

import { type RefundSchedule, refundTimeline } from "./policy";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The policy for a deposit worded `deposit` (an amount, or "20% of the
 * total"); with `checkIn` in real dates, without it in months before
 * arrival.
 */
export function describePolicy(
  t: Translate,
  formatDate: (date: CalendarDate) => string,
  policy: { depositNonRefundable: boolean; schedule?: RefundSchedule | null },
  deposit: string,
  checkIn?: CalendarDate,
): string {
  if (!policy.depositNonRefundable) return t("refundable");
  const schedule = policy.schedule;
  if (!schedule || (schedule.freeMonthsBefore === null && schedule.endPercent === 100)) {
    return t("nonRefundable", { deposit });
  }
  const rest = t("rest");
  const end = schedule.endPercent;
  if (schedule.freeMonthsBefore === null) return `${t("fixed", { deposit, end })} ${rest}`;
  if (!checkIn) {
    const values = {
      deposit,
      free: schedule.freeMonthsBefore,
      ramp: schedule.rampMonths,
      start: schedule.startPercent,
      end,
    };
    return `${t(schedule.rampMonths > 0 ? "freeRampMonths" : "freeMonths", values)} ${rest}`;
  }
  const timeline = refundTimeline(schedule, checkIn);
  const values = {
    deposit,
    freeUntil: formatDate(timeline.freeUntil!),
    start: timeline.startPercent,
    end,
    rampUntil: timeline.ramp ? formatDate(timeline.ramp.until) : "",
  };
  return `${t(timeline.ramp ? "freeRampDated" : "freeDated", values)} ${rest}`;
}
