import { z } from "zod";

import { notFound, validationError } from "@/lib/api";
import { getPublicAvailability } from "@/lib/booking-rules/public-availability";
import { daysBetween, isCalendarDate } from "@/lib/calendar-date";
import { getListedProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/public/properties/[slug]/availability">;

/** About six months per request: the picker asks for a couple at a time. */
const MAX_WINDOW_DAYS = 186;

const query = z
  .object({
    from: z.string().refine(isCalendarDate, "must be a date as YYYY-MM-DD"),
    to: z.string().refine(isCalendarDate, "must be a date as YYYY-MM-DD"),
  })
  .superRefine(({ from, to }, context) => {
    if (!isCalendarDate(from) || !isCalendarDate(to)) return;
    const days = daysBetween(from, to);
    if (days < 1) context.addIssue({ code: "custom", path: ["to"], message: "must be after from" });
    else if (days > MAX_WINDOW_DAYS) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: `the window may span at most ${MAX_WINDOW_DAYS} days`,
      });
    }
  });

/**
 * A listed property's public calendar (GitLab #108):
 *
 *   GET /api/public/properties/:slug/availability?from=2026-07-01&to=2026-09-01
 *
 * Per night only `available` (a stay may include it) and `checkIn` (a stay
 * may start that day), with the booking rules applied - never why a night is
 * unavailable, and no guest data. Also the stay lengths allowed and the
 * rates for the price estimate. Cached briefly, by the server's calendar
 * cache and by the browser.
 */
export async function GET(request: Request, { params }: Context) {
  const property = await getListedProperty((await params).slug);
  if (!property) return notFound("Property");
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return validationError(parsed.error);
  return Response.json(await getPublicAvailability(property, parsed.data), {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
