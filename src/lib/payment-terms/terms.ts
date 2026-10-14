/**
 * Payment terms and the hold they put on a reserved booking (GitLab #114),
 * as pure functions over plain data. Client-safe.
 *
 * Accepting a request reserves its dates until the first payment arrives:
 * - normally a deposit (a percentage of the total, or a fixed amount), due
 *   some days after acceptance, and the balance some days before arrival;
 * - at short notice - arrival no further off than the balance's lead - the
 *   full amount, due within a few days.
 * Dates are calendar days in the property's timezone; a deadline passes
 * when its day has ended there. No deadline falls after the day before
 * arrival, nor before today.
 */
import { addDays, type CalendarDate, daysBetween } from "@/lib/calendar-date";

export type PaymentTerms = {
  /** The deposit: a percentage of the total, or a fixed amount - one of them. */
  depositPercent: number | null;
  depositFixedMinor: number | null;
  /** Days after acceptance the deposit is due. */
  depositDueDays: number;
  /** Days before arrival the balance is due; also the short-notice line. */
  balanceDueDaysBefore: number;
  /** Days after acceptance the full amount is due at short notice. */
  fullPaymentDueDays: number;
};

/**
 * Common German holiday-rental practice: 20% within a week, the balance 30
 * days before arrival (what the BGH found appropriate for package travel),
 * the full amount within 3 days when arrival is closer than that.
 */
export const DEFAULT_TERMS: PaymentTerms = {
  depositPercent: 20,
  depositFixedMinor: null,
  depositDueDays: 7,
  balanceDueDaysBefore: 30,
  fullPaymentDueDays: 3,
};

export type Hold = {
  /** What is due first: the deposit, or the full amount. */
  depositAmountMinor: number;
  depositDueOn: CalendarDate;
  /** When the rest is due; null when the first payment is all of it. */
  balanceDueOn: CalendarDate | null;
};

const later = (a: CalendarDate, b: CalendarDate) => (a > b ? a : b);
const earlier = (a: CalendarDate, b: CalendarDate) => (a < b ? a : b);

/** The deposit for `totalMinor`: rounded to the minor unit, never more than the total. */
export function depositFor(totalMinor: number, terms: PaymentTerms): number {
  const amount =
    terms.depositPercent !== null
      ? Math.round((totalMinor * terms.depositPercent) / 100)
      : (terms.depositFixedMinor ?? 0);
  return Math.min(amount, totalMinor);
}

/** The hold on a booking of `totalMinor` arriving `checkIn`, accepted `today`. */
export function holdFor(
  {
    totalMinor,
    checkIn,
    today,
  }: { totalMinor: number; checkIn: CalendarDate; today: CalendarDate },
  terms: PaymentTerms,
): Hold {
  // The last day to pay: the day before arrival, unless that has passed.
  const lastDay = later(today, addDays(checkIn, -1));
  const due = (days: number) => earlier(addDays(today, days), lastDay);

  const shortNotice = daysBetween(today, checkIn) <= terms.balanceDueDaysBefore;
  const deposit = depositFor(totalMinor, terms);
  if (shortNotice || deposit >= totalMinor) {
    return {
      depositAmountMinor: totalMinor,
      depositDueOn: due(shortNotice ? terms.fullPaymentDueDays : terms.depositDueDays),
      balanceDueOn: null,
    };
  }
  const depositDueOn = due(terms.depositDueDays);
  return {
    depositAmountMinor: deposit,
    depositDueOn,
    // Never before the deposit: arrival just past the short-notice line
    // brings the two together.
    balanceDueOn: later(addDays(checkIn, -terms.balanceDueDaysBefore), depositDueOn),
  };
}

/** Reminders: this many days before a deadline. */
export const DEPOSIT_REMINDER_DAYS = 2;
export const BALANCE_REMINDER_DAYS = 7;
