/**
 * The guest's calendar download (GitLab #125) against a real PostgreSQL:
 * opened by the guest's link and nothing else, written from the booking's
 * times, never with the exact address.
 */
import ICAL from "ical.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET } from "@/app/(public)/stay/booking/[token]/calendar.ics/route";
import { reserveBooking } from "@/lib/bookings/hold";
import { createBooking } from "@/lib/bookings/service";
import { db } from "@/lib/db";
import { saveListing, saveStayTimes } from "@/lib/listing/service";
import { listingSchema } from "@/lib/listing/schema";
import { issueGuestToken } from "@/lib/payments/guest-link";

import { stayUid } from "./stay-event";

let propertyId: string;
let bookingId: string;
let token: string;

const download = (t: string, lang = "en-GB") =>
  GET(new Request(`http://test/stay/booking/${t}/calendar.ics?lang=${lang}`), {
    params: Promise.resolve({ token: t }),
  });

beforeAll(async () => {
  propertyId = (
    await db.property.create({
      data: {
        name: "Owner's internal name",
        timezone: "Europe/Berlin",
        currency: "EUR",
        color: "#0f766e",
        defaultNightlyRateMinor: 10_000,
      },
    })
  ).id;
  await saveListing(
    propertyId,
    listingSchema.parse({
      titleEn: "Dorum 1",
      location: "Dorum",
      exactAddress: "Deichweg 3, 27632 Dorum",
    }),
  );
  await saveStayTimes(propertyId, {
    checkInTime: "15:00",
    earliestCheckOutTime: "10:00",
    checkOutTime: "11:00",
  });
  const guestId = (await db.guest.create({ data: { name: "Ada" } })).id;
  const made = await createBooking({
    propertyId,
    guestId,
    checkIn: "2026-09-10",
    checkOut: "2026-09-14",
    status: "inquiry",
    source: "direct",
    guestCount: 2,
  });
  if (!("booking" in made)) throw new Error(JSON.stringify(made));
  bookingId = made.booking.id;
  await reserveBooking(bookingId, new Date("2026-07-01T12:00:00Z"));
  token = await issueGuestToken(bookingId);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("the calendar download", () => {
  it("is the stay as one event, from the times it was reserved under", async () => {
    // Changed after reserving: the booking keeps its times (GitLab #126).
    await saveStayTimes(propertyId, {
      checkInTime: "17:00",
      earliestCheckOutTime: null,
      checkOutTime: "09:00",
    });
    const response = await download(token);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    const ics = await response.text();
    const vevent = new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent("vevent")!;
    const event = new ICAL.Event(vevent);
    expect(event.uid).toBe(stayUid(bookingId));
    expect(event.startDate.toJSDate().toISOString()).toBe("2026-09-10T13:00:00.000Z");
    expect(event.endDate.toJSDate().toISOString()).toBe("2026-09-14T09:00:00.000Z");
    expect(event.summary).toBe("Stay: Dorum 1");
    expect(event.location).toBe("Dorum");
    expect(event.description).toContain("Departure between 10:00 and 11:00");
    expect(vevent.getFirstPropertyValue("status")).toBe("TENTATIVE");
    // Nothing internal, never the exact address.
    expect(ics).not.toMatch(/Deichweg|internal name|Ada/);
    expect(ics).not.toContain(bookingId);
  });

  it("speaks the page's language", async () => {
    expect(await (await download(token, "de-DE")).text()).toContain("SUMMARY:Aufenthalt: Dorum 1");
  });

  it("is a plain 404 without a valid token", async () => {
    for (const t of ["AAAAAAAAAAAAAAAAAAAAAA", "not-a-token", token.slice(1)]) {
      const response = await download(t);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found");
    }
  });
});
