import { describe, expect, it } from "vitest";

import type { CalendarEvent } from "./calendar";
import { blockedNights } from "./inbound-import";

const event = (fields: Partial<CalendarEvent>): CalendarEvent => ({
  id: "e1",
  etag: '"1"',
  status: "confirmed",
  updated: "",
  start: { date: "2026-12-01" },
  end: { date: "2026-12-04" },
  ...fields,
});
const nights = (fields: Partial<CalendarEvent>, timezone = "Europe/Lisbon") =>
  blockedNights(event(fields), timezone, 12);

describe("blockedNights", () => {
  it("takes an all-day event's own dates, end exclusive", () => {
    expect(nights({})).toEqual({ start: "2026-12-01", end: "2026-12-04" });
  });

  it("skips the app's own events, free time and cancelled events", () => {
    expect(
      nights({ extendedProperties: { private: { vacationHome: "booking", bookingId: "b" } } }),
    ).toBeNull();
    expect(nights({ transparency: "transparent" })).toBeNull();
    expect(nights({ status: "cancelled" })).toBeNull();
  });

  it("blocks every night a long timed event touches, in the property's timezone", () => {
    // Mon 15:00 to Wed 11:00 Lisbon: the Monday and Tuesday nights.
    expect(
      nights({
        start: { dateTime: "2026-12-07T15:00:00Z" },
        end: { dateTime: "2026-12-09T11:00:00Z" },
      }),
    ).toEqual({ start: "2026-12-07", end: "2026-12-09" });
    // Arrives 23:30 UTC = 08:30 next day in Tokyo.
    expect(
      nights(
        { start: { dateTime: "2026-12-07T23:30:00Z" }, end: { dateTime: "2026-12-09T02:00:00Z" } },
        "Asia/Tokyo",
      ),
    ).toEqual({ start: "2026-12-08", end: "2026-12-09" });
  });

  it("gives a long event within one day its night", () => {
    expect(
      nights({
        start: { dateTime: "2026-12-07T06:00:00Z" },
        end: { dateTime: "2026-12-07T20:00:00Z" },
      }),
    ).toEqual({ start: "2026-12-07", end: "2026-12-08" });
  });

  it("ignores timed events shorter than the threshold", () => {
    expect(
      nights({
        start: { dateTime: "2026-12-07T09:00:00Z" },
        end: { dateTime: "2026-12-07T17:00:00Z" },
      }),
    ).toBeNull();
  });
});
