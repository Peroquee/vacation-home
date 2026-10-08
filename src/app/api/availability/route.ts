import { z } from "zod";

import { fieldError, validationError } from "@/lib/api";
import { getCalendars } from "@/lib/availability/calendar";
import { daysBetween, isCalendarDate } from "@/lib/calendar-date";

/** The longest window one request may cover: a year and a day. */
const MAX_WINDOW_DAYS = 366;
const MAX_PROPERTIES = 20;

const query = z
  .object({
    propertyIds: z.preprocess(
      (value) =>
        typeof value === "string" && value ? value.split(",").map((id) => id.trim()) : [],
      z
        .array(z.uuid("must be property ids"))
        .min(1, "is required: one or more property ids, comma-separated")
        .max(MAX_PROPERTIES, `at most ${MAX_PROPERTIES} properties per request`),
    ),
    from: z.string().refine(isCalendarDate, "must be a date as YYYY-MM-DD"),
    to: z.string().refine(isCalendarDate, "must be a date as YYYY-MM-DD"),
  })
  .superRefine(({ from, to }, context) => {
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
 * Everything a calendar view needs, in one request:
 *
 *   GET /api/availability?propertyIds=<id>,<id>&from=2026-07-01&to=2026-10-01
 *
 * For each property, in the order asked: the property, its non-cancelled
 * bookings and its blocks touching [from, to), and a night-by-night `days`
 * map (available / inquiry / booked / blocked, with turnover markers).
 * Cached per property and window; every booking, block, property or guest
 * change invalidates the windows it affects.
 */
export async function GET(request: Request) {
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return validationError(parsed.error);

  const { propertyIds, from, to } = parsed.data;
  const { calendars, missing } = await getCalendars([...new Set(propertyIds)], {
    start: from,
    end: to,
  });
  if (missing.length > 0) return fieldError("propertyIds", `unknown: ${missing.join(", ")}`);

  return Response.json({ from, to, properties: calendars });
}
