import { type APIRequestContext, expect, test } from "@playwright/test";

import { withE2eDb } from "./database";
import { day } from "./dates";

// The public availability calendar (GitLab #108): free or not per night,
// never why, and a price estimate equal to the booking total.

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    // Booking income is on (GitLab #137): bookings have ledger entries.
    await db.query("DELETE FROM transactions WHERE booking_id IS NOT NULL");
    await db.query("DELETE FROM bookings");
    await db.query("DELETE FROM blocks");
    await db.query("DELETE FROM ical_feeds");
    await db.query("DELETE FROM guests");
    await db.query("DELETE FROM properties");
  });
});

async function listedProperty(request: APIRequestContext) {
  return (await (
    await request.post("/api/properties", {
      data: {
        name: "Calendar Lake",
        // UTC, so "today" here is today there.
        timezone: "UTC",
        currency: "EUR",
        defaultNightlyRateMinor: 12_345,
        defaultCleaningFeeMinor: 4_000,
        slug: "calendar-lake",
        publiclyListed: true,
      },
    })
  ).json()) as { id: string };
}

test("a booking, an owner block and an iCal stay all look the same: unavailable", async ({
  request,
  browser,
}) => {
  const property = await listedProperty(request);
  const guest = await (
    await request.post("/api/guests", { data: { name: "Ada Secretguest" } })
  ).json();
  const confirmed = await (
    await request.post("/api/bookings", {
      data: {
        propertyId: property.id,
        guestId: guest.id,
        checkIn: day(20),
        checkOut: day(23),
        status: "confirmed",
      },
    })
  ).json();
  // A pending request: it does not hold its dates.
  await request.post("/api/bookings", {
    data: { propertyId: property.id, guestId: guest.id, checkIn: day(50), checkOut: day(53) },
  });
  const block = await (
    await request.post("/api/blocks", {
      data: {
        propertyId: property.id,
        startDate: day(30),
        endDate: day(33),
        reason: "Roof repairs",
      },
    })
  ).json();
  const icalIds = await withE2eDb(async (db) => {
    const feed = await db.query(
      `INSERT INTO ical_feeds (property_id, name, url, updated_at)
       VALUES ($1, 'Airbnb', 'https://www.airbnb.example/calendar/ical/1.ics', now()) RETURNING id`,
      [property.id],
    );
    const imported = await db.query(
      `INSERT INTO blocks (property_id, start_date, end_date, reason, origin, external_event_id, feed_id, updated_at)
       VALUES ($1, $2, $3, 'Airbnb (Not available)', 'ical', 'airbnb-uid-1@airbnb.example', $4, now()) RETURNING id`,
      [property.id, day(40), day(43), feed.rows[0].id],
    );
    return [feed.rows[0].id as string, imported.rows[0].id as string];
  });

  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const response = await stranger.request.get(
    `/api/public/properties/calendar-lake/availability?from=${day(15)}&to=${day(60)}`,
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("public, max-age=60");
  const text = await response.text();
  const body = JSON.parse(text);
  const night = (offset: number) =>
    body.nights.find((n: { date: string }) => n.date === day(offset));

  // Each of the three: its nights unavailable, and exactly alike.
  for (const [start, end] of [
    [20, 23],
    [30, 33],
    [40, 43],
  ]) {
    for (let offset = start!; offset < end!; offset++) {
      expect(night(offset), day(offset)).toEqual({
        date: day(offset),
        available: false,
        checkIn: false,
      });
    }
    // Their check-out day is free for the next arrival.
    expect(night(end!)).toMatchObject({ available: true, checkIn: true });
  }
  // The pending request blocks nothing.
  expect(night(51)).toMatchObject({ available: true, checkIn: true });

  // No hint of which is which, and nothing about anyone.
  for (const nightBody of body.nights) {
    expect(Object.keys(nightBody).sort()).toEqual(["available", "checkIn", "date"]);
  }
  for (const secret of [
    "Ada",
    "Secretguest",
    "Roof",
    "Airbnb",
    "airbnb",
    "booked",
    "blocked",
    "inquiry",
    "reason",
    "origin",
    "guest",
    confirmed.id,
    block.id,
    guest.id,
    property.id,
    ...icalIds,
  ]) {
    expect(text, secret).not.toContain(secret);
  }
  await stranger.close();
});

test("a guest picks a stay and sees the estimate the booking would total", async ({
  request,
  browser,
}) => {
  const property = await listedProperty(request);
  await request.put(`/api/properties/${property.id}/booking-rules`, {
    data: {
      minNights: 2,
      maxNights: null,
      minLeadDays: 0,
      horizonDays: null,
      checkInWeekdays: [],
      bufferDays: 0,
    },
  });
  const guest = await (await request.post("/api/guests", { data: { name: "Ada" } })).json();
  await request.post("/api/bookings", {
    data: {
      propertyId: property.id,
      guestId: guest.id,
      checkIn: day(9),
      checkOut: day(12),
      status: "confirmed",
    },
  });

  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await stranger.newPage();
  await page.goto("/stay/calendar-lake");
  const dayButton = (offset: number) => page.locator(`button[data-date="${day(offset)}"]`).first();

  await expect(page.getByText("The minimum stay is 2 nights.")).toBeVisible();
  // Taken nights cannot be picked, and the one-night gap before them is too short.
  await expect(dayButton(10)).toBeDisabled();
  await expect(dayButton(8)).toBeDisabled();
  await dayButton(4).click();
  // Departures: two nights at least, and not past the booking.
  await expect(dayButton(5)).not.toHaveAccessibleName(/possible departure/);
  await expect(dayButton(6)).toHaveAccessibleName(/possible departure/);
  await expect(dayButton(9)).toHaveAccessibleName(/possible departure/);
  await expect(dayButton(10)).toBeDisabled();
  await dayButton(8).click();

  const estimate = page.getByTestId("stay-estimate");
  await expect(estimate).toContainText("4 nights × €123.45 · standard rate€493.80");
  await expect(estimate).toContainText("Cleaning fee€40.00");

  // The booking API's own total for the same dates.
  const booking = await (
    await request.post("/api/bookings", {
      data: { propertyId: property.id, guestId: guest.id, checkIn: day(4), checkOut: day(8) },
    })
  ).json();
  expect(booking.totalAmountMinor).toBe(4 * 12_345 + 4_000);
  await expect(estimate).toContainText("Total€533.80");
  await stranger.close();
});
