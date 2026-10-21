/**
 * A new recurring cost pre-filled from the expense dialog (GitLab #130):
 * "Make recurring" there opens /finance/recurring?new=1 with what was typed.
 * Pure and client-safe; anything invalid is left for the form to ask.
 */
import { isUuid } from "@/lib/api";
import { isCalendarDate } from "@/lib/calendar-date";

export type NewRulePrefill = {
  propertyId?: string;
  categoryId: string;
  amountMinor?: number;
  startDate?: string;
  description: string;
};

/** A new rule from the expense dialog's values (GitLab #130); invalid ones left blank. */
export function newRulePrefill(
  params: Record<string, string | string[] | undefined>,
): NewRulePrefill {
  const one = (key: string) => (typeof params[key] === "string" ? params[key] : "");
  const amount = Number(one("amountMinor"));
  const date = one("date");
  return {
    propertyId: isUuid(one("propertyId")) ? one("propertyId") : undefined,
    categoryId: isUuid(one("categoryId")) ? one("categoryId") : "",
    amountMinor: Number.isSafeInteger(amount) && amount > 0 ? amount : undefined,
    startDate: isCalendarDate(date) ? date : undefined,
    description: one("description").slice(0, 500),
  };
}
