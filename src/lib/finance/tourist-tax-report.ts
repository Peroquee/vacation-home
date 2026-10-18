/**
 * The Kurtaxe report (GitLab #120): per month of a year, what is owed to
 * the municipality for the stays, and what has come in for it. Server-side.
 *
 * - Owed: the Kurtaxe of the booked stays (confirmed or paid), by the month
 *   they start in. Municipalities differ on what they count (arrival,
 *   nights, payment), so the owner checks theirs; the user guide says so.
 * - Collected: the entries in the pass-through category "Kurtaxe
 *   (durchlaufend)", by their date - payments less refunds.
 *
 * Per currency, as a property's amounts are all in its own.
 */
import { BOOKED_STATUSES } from "@/lib/bookings/values";
import { db } from "@/lib/db";

export type TouristTaxMonth = {
  /** "YYYY-MM". */
  month: string;
  owedMinor: number;
  /** Booked stays starting that month with Kurtaxe. */
  stays: number;
  collectedMinor: number;
};

export type TouristTaxReport = { currency: string; months: TouristTaxMonth[] }[];

export async function touristTaxReport(
  year: number,
  propertyId?: string,
): Promise<TouristTaxReport> {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const property = propertyId ? { propertyId } : {};
  const [bookings, entries] = await Promise.all([
    db.booking.findMany({
      where: {
        ...property,
        status: { in: [...BOOKED_STATUSES] },
        checkIn: { gte: start, lt: end },
        touristTaxMinor: { gt: 0 },
      },
      select: { checkIn: true, currency: true, touristTaxMinor: true },
    }),
    db.transaction.findMany({
      where: {
        ...property,
        category: { systemKey: "tourist_tax" },
        date: { gte: start, lt: end },
      },
      select: { date: true, currency: true, amountMinor: true },
    }),
  ]);

  const byCurrency = new Map<string, TouristTaxMonth[]>();
  const months = (currency: string) => {
    let list = byCurrency.get(currency);
    if (!list) {
      list = Array.from({ length: 12 }, (_, i) => ({
        month: `${year}-${String(i + 1).padStart(2, "0")}`,
        owedMinor: 0,
        stays: 0,
        collectedMinor: 0,
      }));
      byCurrency.set(currency, list);
    }
    return list;
  };
  for (const booking of bookings) {
    const month = months(booking.currency)[booking.checkIn.getUTCMonth()]!;
    month.owedMinor += booking.touristTaxMinor;
    month.stays++;
  }
  for (const entry of entries) {
    months(entry.currency)[entry.date.getUTCMonth()]!.collectedMinor += entry.amountMinor;
  }
  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, list]) => ({ currency, months: list }));
}
