import { toUtcDate } from "@/lib/calendar-date";
import { HOLDING_STATUSES } from "@/lib/bookings/values";
import { db } from "@/lib/db";
import { buildFeed, FEED_HISTORY_DAYS } from "@/lib/ical/export";
import { propertyForToken } from "@/lib/ical/feeds";
import { addDays, fromUtcDate } from "@/lib/calendar-date";
import { todayIn } from "@/lib/finance/recurring";

/**
 * A property's export feed, for the booking platforms (GitLab #99). Public:
 * the token in the URL is the secret (src/lib/access.ts), and requests are
 * rate-limited (src/lib/rate-limit.ts). An unknown token is a plain 404 that
 * says nothing about whether the property exists.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/ical/[token]">) {
  const { token } = await params;
  const property = await propertyForToken(token.replace(/\.ics$/, ""));
  if (!property) return new Response("Not found", { status: 404 });

  const today = todayIn(property.timezone);
  const since = toUtcDate(addDays(today, -FEED_HISTORY_DAYS));
  const [bookings, blocks] = await Promise.all([
    db.booking.findMany({
      where: {
        propertyId: property.id,
        status: { in: [...HOLDING_STATUSES] },
        checkOut: { gt: since },
      },
      select: { id: true, checkIn: true, checkOut: true },
    }),
    db.block.findMany({
      where: { propertyId: property.id, endDate: { gt: since } },
      select: { id: true, startDate: true, endDate: true },
    }),
  ]);
  const body = buildFeed({
    propertyName: property.name,
    today,
    entries: [
      ...bookings.map((b) => ({
        kind: "booking" as const,
        id: b.id,
        start: fromUtcDate(b.checkIn),
        end: fromUtcDate(b.checkOut),
      })),
      ...blocks.map((b) => ({
        kind: "block" as const,
        id: b.id,
        start: fromUtcDate(b.startDate),
        end: fromUtcDate(b.endDate),
      })),
    ],
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="availability.ics"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
