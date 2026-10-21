import { getLocale } from "next-intl/server";

import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";
import { guestStayEvent } from "@/lib/ical/guest-stay";
import { stayCalendar } from "@/lib/ical/stay-event";

/**
 * The guest's stay as an .ics file (GitLab #125), for their own calendar.
 * Opened by the guest's link exactly as their page is: an unknown token is
 * a plain 404. Written on request, never stored; `?lang=` keeps the page's
 * language, which a calendar app opening the file would not send.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/stay/booking/[token]/calendar.ics">,
) {
  const lang = new URL(request.url).searchParams.get("lang");
  const locale = lang && isLocale(lang) ? lang : await getLocale();
  const event = await guestStayEvent(
    (await params).token,
    isLocale(locale) ? locale : DEFAULT_LOCALE,
  );
  if (!event) return new Response("Not found", { status: 404 });
  return new Response(stayCalendar(event), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="stay.ics"',
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
