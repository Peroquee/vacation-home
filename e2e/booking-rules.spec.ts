import { type APIRequestContext, expect, test } from "@playwright/test";

import { withE2eDb } from "./database";

// Booking rules per property (GitLab #107): set in settings, refused on the
// public site with a message per field, and only a warning in the owner's
// own booking form.

const today = new Date().toISOString().slice(0, 10);
function day(offset: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const RULES = {
  minNights: 3,
  maxNights: null,
  minLeadDays: 2,
  horizonDays: 200,
  checkInWeekdays: [],
  bufferDays: 1,
};

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("DELETE FROM bookings");
    await db.query("DELETE FROM blocks");
    await db.query("DELETE FROM guests");
    await db.query("DELETE FROM properties");
  });
});

/** A listed property (UTC, so "today" here is today there) with the rules above. */
async function listedProperty(request: APIRequestContext) {
  const property = await (
    await request.post("/api/properties", {
      data: {
        name: "Rules Lake",
        timezone: "UTC",
        currency: "EUR",
        slug: "rules-lake",
        publiclyListed: true,
      },
    })
  ).json();
  const saved = await request.put(`/api/properties/${property.id}/booking-rules`, { data: RULES });
  expect(saved.status()).toBe(200);
  return property as { id: string };
}

test("the rules are stored per property and checked for sense", async ({ request }) => {
  const property = await listedProperty(request);
  expect(await (await request.get(`/api/properties/${property.id}/booking-rules`)).json()).toEqual(
    RULES,
  );

  const refused = await request.put(`/api/properties/${property.id}/booking-rules`, {
    data: { ...RULES, maxNights: 2, checkInWeekdays: [8] },
  });
  expect(refused.status()).toBe(422);
  expect((await refused.json()).error.fields).toMatchObject({
    maxNights: ["must not be less than the minimum stay"],
    checkInWeekdays: ["must be weekdays from 1 (Monday) to 7 (Sunday), each once"],
  });
});

test.describe("on the public site", () => {
  test("a stay that breaks a rule is refused, per field, without saying what takes the dates", async ({
    request,
    browser,
  }) => {
    const property = await listedProperty(request);
    const guest = await (await request.post("/api/guests", { data: { name: "Ada" } })).json();
    const booked = await request.post("/api/bookings", {
      data: {
        propertyId: property.id,
        guestId: guest.id,
        checkIn: day(30),
        checkOut: day(35),
        status: "confirmed",
      },
    });
    expect(booked.status()).toBe(201);
    const blocked = await request.post("/api/blocks", {
      data: { propertyId: property.id, startDate: day(50), endDate: day(55), reason: "Painting" },
    });
    expect(blocked.status()).toBe(201);

    // A stranger, as the booking site sees one.
    const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const check = async (checkIn: string, checkOut: string) => {
      const response = await stranger.request.get(
        `/api/public/properties/rules-lake/stay-check?checkIn=${checkIn}&checkOut=${checkOut}`,
      );
      return { status: response.status(), body: await response.json() };
    };

    expect(await check(day(10), day(14))).toEqual({ status: 200, body: { ok: true } });

    const refusals: [string, string, Record<string, string[]>][] = [
      [day(1), day(5), { checkIn: ["must be at least 2 days from today"] }],
      [day(10), day(11), { checkOut: ["the stay must be at least 3 nights"] }],
      [day(201), day(205), { checkIn: ["can be at most 200 days ahead"] }],
      [day(35), day(39), { checkIn: ["needs 1 free night after the stay before"] }],
      [day(26), day(30), { checkOut: ["needs 1 free night before the next stay"] }],
      [day(52), day(58), { checkIn: ["these dates are not available"] }],
      [day(32), day(36), { checkIn: ["these dates are not available"] }],
    ];
    for (const [checkIn, checkOut, fields] of refusals) {
      const { status, body } = await check(checkIn, checkOut);
      expect({ checkIn, checkOut, status, fields: body.error?.fields }).toEqual({
        checkIn,
        checkOut,
        status: 422,
        fields,
      });
      // Nothing about what is in the way.
      expect(JSON.stringify(body)).not.toMatch(/Painting|Ada|block|booking/i);
    }
    await stranger.close();
  });

  test("an unlisted property cannot be checked at all", async ({ request, browser }) => {
    const property = await listedProperty(request);
    await request.patch(`/api/properties/${property.id}`, { data: { publiclyListed: false } });
    const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const response = await stranger.request.get(
      `/api/public/properties/rules-lake/stay-check?checkIn=${day(10)}&checkOut=${day(14)}`,
    );
    expect(response.status()).toBe(404);
    await stranger.close();
  });
});

test("the owner sets the rules in settings and is warned, not stopped, in the booking form", async ({
  page,
  request,
}) => {
  const property = await (
    await request.post("/api/properties", {
      data: { name: "Rules Lake", timezone: "UTC", currency: "EUR" },
    })
  ).json();

  await page.goto("/settings");
  await page.getByRole("button", { name: "Edit the booking rules of Rules Lake" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Minimum nights").fill("3");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#booking-rules")).toContainText("at least 3 nights");

  await page.goto(`/bookings/new?propertyId=${property.id}&checkIn=${day(10)}&checkOut=${day(11)}`);
  await expect(page.getByText("Outside this property's booking rules")).toBeVisible();
  await expect(page.getByText("Check-out the stay must be at least 3 nights")).toBeVisible();
});
