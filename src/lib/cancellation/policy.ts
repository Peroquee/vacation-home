/**
 * The cancellation policy (GitLab #116, #123), as pure functions over plain
 * data. Client-safe: the public estimate and the request form show the
 * same dates as the cancel computation.
 *
 * The owner's rule: when a guest cancels, part of the deposit may be kept,
 * and anything paid beyond the deposit is refunded in full (the Kurtaxe is
 * never part of the deposit). How much of the deposit is kept depends on
 * when the guest cancels (#123):
 *
 * - until `freeMonthsBefore` months before arrival: nothing (the free
 *   window; its last day included);
 * - then rising linearly, day by day, from `startPercent` to `endPercent`
 *   over `rampMonths` months;
 * - after that, until arrival and beyond: `endPercent`.
 *
 * Without a schedule - and with no free window and no ramp - a fixed share
 * is kept: all of the deposit, as #116 had it. With the deposit refundable,
 * nothing is kept. Months count back from the arrival day, a day past the
 * month's end landing on its last day (31 March, one month back: 28 or 29
 * February). Dates are calendar dates in the property's timezone.
 */
import { addDays, type CalendarDate, daysBetween } from "@/lib/calendar-date";

/** When the deposit is kept, and how much of it (GitLab #123). */
export type RefundSchedule = {
  /** Months before arrival until which cancelling is free; null for none. */
  freeMonthsBefore: number | null;
  /** Months, after the free window, over which the kept share rises; 0 for none. */
  rampMonths: number;
  /** The share of the deposit kept on the ramp's first day, in percent. */
  startPercent: number;
  /** The share kept from the ramp's end until arrival, in percent. */
  endPercent: number;
};

/** The policy a booking is under, kept on it when the guest agrees to it. */
export type CancellationTerms = {
  depositNonRefundable: boolean;
  /** The deposit as it was when the guest agreed: what may be kept. */
  depositAmountMinor: number;
  /** Null or absent: all of the deposit is kept (#116). */
  schedule?: RefundSchedule | null;
};

export type GuestRefund = {
  /** What the guest has paid, less what was refunded already. */
  receivedMinor: number;
  /** Kept of the deposit. */
  retainedMinor: number;
  refundMinor: number;
};

/** `date` moved `months` back, a missing day landing on the month's last. */
export function monthsBefore(date: CalendarDate, months: number): CalendarDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) - months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(Math.min(d, last))}`;
}

/** The schedule's dates for an arrival on `checkIn`. */
export type RefundTimeline = {
  /** The last day cancelling is free; null without a free window. */
  freeUntil: CalendarDate | null;
  /** The ramp's first and last day; null without a ramp. */
  ramp: { from: CalendarDate; until: CalendarDate } | null;
  startPercent: number;
  endPercent: number;
};

export function refundTimeline(schedule: RefundSchedule, checkIn: CalendarDate): RefundTimeline {
  if (schedule.freeMonthsBefore === null) {
    return {
      freeUntil: null,
      ramp: null,
      startPercent: schedule.endPercent,
      endPercent: schedule.endPercent,
    };
  }
  const freeUntil = monthsBefore(checkIn, schedule.freeMonthsBefore);
  if (schedule.rampMonths <= 0) {
    return {
      freeUntil,
      ramp: null,
      startPercent: schedule.endPercent,
      endPercent: schedule.endPercent,
    };
  }
  const until = monthsBefore(checkIn, schedule.freeMonthsBefore - schedule.rampMonths);
  const from = addDays(freeUntil, 1);
  return {
    freeUntil,
    ramp: until >= from ? { from, until } : null,
    startPercent: schedule.startPercent,
    endPercent: schedule.endPercent,
  };
}

/**
 * The share of the deposit kept when cancelling on `date`, as a fraction
 * (numerator / denominator, in percent), exact for the per-day ramp.
 */
function shareOn(
  schedule: RefundSchedule | null | undefined,
  checkIn: CalendarDate,
  date: CalendarDate,
): { percent: number; of: number } {
  if (!schedule) return { percent: 100, of: 1 };
  const timeline = refundTimeline(schedule, checkIn);
  if (timeline.freeUntil !== null && date <= timeline.freeUntil) return { percent: 0, of: 1 };
  if (timeline.ramp && date <= timeline.ramp.until) {
    const span = daysBetween(timeline.ramp.from, timeline.ramp.until);
    if (span === 0) return { percent: timeline.endPercent, of: 1 };
    const elapsed = daysBetween(timeline.ramp.from, date);
    return {
      percent:
        timeline.startPercent * span + (timeline.endPercent - timeline.startPercent) * elapsed,
      of: span,
    };
  }
  return { percent: timeline.endPercent, of: 1 };
}

/** The share of the deposit kept when cancelling on `date`, in percent (for display). */
export function keptPercentOn(
  terms: CancellationTerms,
  checkIn: CalendarDate,
  date: CalendarDate,
): number {
  if (!terms.depositNonRefundable) return 0;
  const { percent, of } = shareOn(terms.schedule, checkIn, date);
  return percent / of;
}

/**
 * What a guest who cancels gets back of `receivedMinor` under `terms`,
 * cancelling `when.today` for an arrival on `when.checkIn`. Without `when`
 * the share after any free window and ramp applies.
 */
export function guestRefund(
  terms: CancellationTerms,
  receivedMinor: number,
  when?: { checkIn: CalendarDate; today: CalendarDate },
): GuestRefund {
  const received = Math.max(0, receivedMinor);
  const deposit = Math.max(0, terms.depositAmountMinor);
  let kept = 0;
  if (terms.depositNonRefundable) {
    const { percent, of } = when
      ? shareOn(terms.schedule, when.checkIn, when.today)
      : { percent: terms.schedule ? terms.schedule.endPercent : 100, of: 1 };
    // Integer arithmetic first, one rounding at the end.
    kept = Math.round((deposit * percent) / (100 * of));
  }
  const retained = Math.min(received, kept);
  return { receivedMinor: received, retainedMinor: retained, refundMinor: received - retained };
}
