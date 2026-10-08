import { expect, test } from "@playwright/test";

import { withE2eDb } from "./database";

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("DELETE FROM bookings");
    await db.query("DELETE FROM guests");
    await db.query("DELETE FROM properties");
  });
});

test("an overlapping confirmed booking is refused over HTTP with a 409 naming the conflict", async ({
  request,
}) => {
  const property = await (
    await request.post("/api/properties", {
      data: {
        name: "Lake House",
        timezone: "Europe/Lisbon",
        currency: "EUR",
        defaultNightlyRateMinor: 10_000,
      },
    })
  ).json();
  const guest = await (await request.post("/api/guests", { data: { name: "Ada" } })).json();
  const stay = (checkIn: string, checkOut: string) => ({
    propertyId: property.id,
    guestId: guest.id,
    checkIn,
    checkOut,
    status: "confirmed",
  });

  const first = await request.post("/api/bookings", { data: stay("2026-07-14", "2026-07-18") });
  expect(first.status()).toBe(201);
  const booking = await first.json();
  expect(booking).toMatchObject({ nights: 4, totalAmountMinor: 40_000, currency: "EUR" });

  const clash = await request.post("/api/bookings", { data: stay("2026-07-17", "2026-07-19") });
  expect(clash.status()).toBe(409);
  expect((await clash.json()).error.conflicts[0].id).toBe(booking.id);

  const turnover = await request.post("/api/bookings", { data: stay("2026-07-18", "2026-07-19") });
  expect(turnover.status()).toBe(201);

  const page = await (await request.get(`/api/bookings?propertyId=${property.id}`)).json();
  expect(page.total).toBe(2);
});
