/**
 * What the guests' help says about a property and a booking (GitLab #127),
 * from the real settings: the values its Markdown names, worded in the
 * visitor's language, and the flags its blocks are kept by. A setting the
 * property does not have is null, and the help leaves its sentence out.
 * Pure: the caller passes the facts and its translators.
 */
import type { BookingStatus } from "@/generated/prisma/client";
import { formatReference } from "@/lib/booking-requests/values";
import type { CalendarDate } from "@/lib/calendar-date";
import { describePolicy } from "@/lib/cancellation/describe";
import { type StayTimes, describeStayTimes } from "@/lib/listing/stay-times";
import type { PaymentTerms } from "@/lib/payment-terms/terms";
import type { TouristTaxRules } from "@/lib/pricing/tourist-tax";

import type { HelpFlags } from "./blocks";
import type { HelpValues } from "./fill";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export type HelpWords = {
  /** The "guestHelp" messages. */
  t: Translate;
  /** The "cancellation" messages. */
  tCancellation: Translate;
  /** The "stayTimes" messages. */
  tTimes: Translate;
  money: (amountMinor: number) => string;
  date: (date: CalendarDate) => string;
};

/** What the property page's help is about: the property's settings. */
export type StayHelpFacts = {
  terms: PaymentTerms;
  currency: string;
  /** Days a request waits for an answer before it lapses. */
  requestExpiryDays: number;
  touristTax: TouristTaxRules | null;
  times: StayTimes;
  /** Bank details are set, so the booking page can show them. */
  bankDetails: boolean;
};

/** The Kurtaxe in a few sentences; null without one. */
export function describeTouristTax(
  words: Pick<HelpWords, "t" | "money">,
  rules: TouristTaxRules | null,
): string | null {
  if (!rules) return null;
  const { t, money } = words;
  if (rules.included) return t("touristTax.included");
  const parts = [t("touristTax.plus", { rate: money(rules.adultRateMinor) })];
  for (const group of rules.childGroups) {
    const ages = { from: group.fromAge, to: group.toAge };
    parts.push(
      group.rateMinor === 0
        ? t("touristTax.childFree", ages)
        : t("touristTax.child", { ...ages, rate: money(group.rateMinor) }),
    );
  }
  if (rules.periods.length > 0) parts.push(t("touristTax.seasons"));
  if (rules.maxNights !== null) parts.push(t("touristTax.maxNights", { count: rules.maxNights }));
  parts.push(t("touristTax.estimate"));
  return parts.join(" ");
}

/** The deposit as the property's terms put it: "20% of the total", or an amount. */
function depositWords(words: HelpWords, terms: PaymentTerms): string {
  return terms.depositPercent !== null
    ? words.tCancellation("percentOfTotal", { percent: terms.depositPercent })
    : words.money(terms.depositFixedMinor ?? 0);
}

/** The property page's help (help/<locale>/public-stay.md). */
export function stayHelp(
  facts: StayHelpFacts,
  words: HelpWords,
): { flags: HelpFlags; values: HelpValues } {
  const { t } = words;
  const { terms } = facts;
  const deposit = depositWords(words, terms);
  // All of it as the deposit: nothing is left for a balance.
  const balance = terms.depositPercent !== 100;
  return {
    flags: {
      girocode: facts.bankDetails && facts.currency === "EUR",
      "bank-details": facts.bankDetails,
    },
    values: {
      deposit,
      depositDue: t("within", { count: terms.depositDueDays }),
      balanceDue: balance ? t("daysBefore", { count: terms.balanceDueDaysBefore }) : null,
      // With no lead for the balance, no arrival is that close.
      shortNotice:
        balance && terms.balanceDueDaysBefore > 0
          ? t("days", { count: terms.balanceDueDaysBefore })
          : null,
      fullDue: t("within", { count: terms.fullPaymentDueDays }),
      requestAnswer: t("within", { count: facts.requestExpiryDays }),
      cancellation: describePolicy(
        words.tCancellation,
        words.date,
        { depositNonRefundable: terms.depositNonRefundable, schedule: terms.refundSchedule },
        deposit,
      ),
      touristTax: describeTouristTax(words, facts.touristTax),
      times: describeStayTimes(words.tTimes, facts.times),
    },
  };
}

/** What the guest page's help is about: the booking as the guest sees it. */
export type BookingHelpFacts = {
  status: BookingStatus;
  /** Declined by the owner (a request; its status is cancelled). */
  declined: boolean;
  /** Was ever reserved: an expiry is the reservation's, else the request's. */
  wasReserved: boolean;
  reference: string | null;
  /** What to quote on the transfer; null without bank details. */
  remittance: string | null;
  girocode: boolean;
  next: { amountMinor: number; dueOn: CalendarDate } | null;
  /** The day a request is answered by; null once it is not one. */
  answerBy: CalendarDate | null;
  /** The owner's contact address (the Impressum's). */
  contact: string | null;
};

/** The guest page's help (help/<locale>/public-booking.md). */
export function bookingHelp(
  facts: BookingHelpFacts,
  words: HelpWords,
): { flags: HelpFlags; values: HelpValues } {
  const { status } = facts;
  const holds = status === "reserved" || status === "confirmed" || status === "paid";
  const next = facts.next && facts.next.amountMinor > 0 ? facts.next : null;
  return {
    flags: {
      inquiry: status === "inquiry",
      reserved: status === "reserved",
      confirmed: status === "confirmed",
      paid: status === "paid",
      declined: status === "cancelled" && facts.declined,
      cancelled: status === "cancelled" && !facts.declined,
      "request-expired": status === "expired" && !facts.wasReserved,
      "reservation-expired": status === "expired" && facts.wasReserved,
      holds,
      transfer: holds && next !== null && facts.remittance !== null,
      girocode: holds && next !== null && facts.girocode,
      reference: facts.reference !== null,
    },
    values: {
      reference: facts.reference ? formatReference(facts.reference) : null,
      remittance: facts.remittance,
      nextAmount: next ? words.money(next.amountMinor) : null,
      nextDate: next ? words.date(next.dueOn) : null,
      answerBy: facts.answerBy ? words.date(facts.answerBy) : null,
      contact: facts.contact,
    },
  };
}
