import { type APIRequestContext, expect, test } from "@playwright/test";

import { withE2eDb } from "./database";

// Payment terms and the reservation hold (GitLab #114): accepting a request
// reserves its dates - refused to anyone else, unavailable on the public
// site - under the property's payment terms, until the deposit arrives.

const today = new Date().toISOString().slice(0, 10);
function day(offset: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("DELETE FROM bookings");
    await db.query("DELETE FROM guests");
    await db.query("DELETE FROM properties");
  });
});

/** A listed property in UTC, so "today" here is today there; 4 nights cost 1100.00. */
async function setUp(request: APIRequestContext) {
  const property = (await (
    await request.post("/api/properties", {
      data: {
        name: "Hold Lake",
        timezone: "UTC",
        currency: "EUR",
        defaultNightlyRateMinor: 25_000,
        defaultCleaningFeeMinor: 10_000,
        slug: "hold-lake",
        publiclyListed: true,
      },
    })
  ).json()) as { id: string };
  const guest = await (await request.post("/api/guests", { data: { name: "Ada" } })).json();
  const inquiry = async (checkIn: string, checkOut: string) =>
    (await (
      await request.post("/api/bookings", {
        data: { propertyId: property.id, guestId: guest.id, checkIn, checkOut },
      })
    ).json()) as { id: string };
  return { property, inquiry };
}

test("an accepted request holds its dates until it is paid", async ({ request, browser }) => {
  const { inquiry } = await setUp(request);
  const booking = await inquiry(day(60), day(64));
  const rival = await inquiry(day(62), day(66));

  const reserved = await request.post(`/api/bookings/${booking.id}/reserve`);
  expect(reserved.status()).toBe(200);
  expect(await reserved.json()).toMatchObject({
    status: "reserved",
    totalAmountMinor: 110_000,
    depositAmountMinor: 22_000,
    depositDueOn: day(7),
    balanceDueOn: day(30),
  });

  // Nobody else gets the dates: not the other request, not the public site.
  const refused = await request.post(`/api/bookings/${rival.id}/reserve`);
  expect(refused.status()).toBe(409);
  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const check = await stranger.request.get(
    `/api/public/properties/hold-lake/stay-check?checkIn=${day(61)}&checkOut=${day(63)}`,
  );
  expect(check.status()).toBe(422);
  const availability = await (
    await stranger.request.get(
      `/api/public/properties/hold-lake/availability?from=${day(58)}&to=${day(66)}`,
    )
  ).json();
  const free = Object.fromEntries(
    availability.nights.map((n: { date: string; available: boolean }) => [n.date, n.available]),
  );
  expect([free[day(59)], free[day(60)], free[day(63)], free[day(64)]]).toEqual([
    true,
    false,
    false,
    true,
  ]);
  await stranger.close();

  // Not something the owner's own form can set.
  const patched = await request.patch(`/api/bookings/${rival.id}`, {
    data: { status: "reserved" },
  });
  expect(patched.status()).toBe(422);
});

test("the owner sees what is due, moves a deadline and records the deposit", async ({
  request,
  page,
}) => {
  const { inquiry } = await setUp(request);
  const booking = await inquiry(day(60), day(64));

  await page.goto(`/bookings/${booking.id}`);
  await page.getByRole("button", { name: "Accept and reserve" }).click();
  await expect(page.getByText("Reserved", { exact: true })).toBeVisible();
  await expect(page.getByText("€220.00 · due")).toBeVisible();

  await page.getByRole("button", { name: "Change deadlines" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Deposit due").fill(day(10));
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  const stored = await (await request.get(`/api/bookings/${booking.id}`)).json();
  expect(stored.depositDueOn).toBe(day(10));

  await page.getByRole("button", { name: "Deposit received" }).click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Balance received" }).click();
  await expect(page.getByText("Paid", { exact: true })).toBeVisible();
});

test("the payment terms are set per property in settings", async ({ request, page }) => {
  const { property } = await setUp(request);
  expect(await (await request.get(`/api/properties/${property.id}/payment-terms`)).json()).toEqual({
    depositPercent: 20,
    depositFixedMinor: null,
    depositDueDays: 7,
    balanceDueDaysBefore: 30,
    fullPaymentDueDays: 3,
  });

  await page.goto("/settings");
  await page.getByRole("button", { name: "Edit the payment terms of Hold Lake" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Deposit (%)").fill("30");
  await dialog.getByLabel("Deposit due (days after accepting)").fill("5");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#payment-terms")).toContainText("30% deposit within 5 days");

  const refused = await request.put(`/api/properties/${property.id}/payment-terms`, {
    data: {
      depositPercent: 20,
      depositFixedMinor: 10_000,
      depositDueDays: 7,
      balanceDueDaysBefore: 30,
      fullPaymentDueDays: 3,
    },
  });
  expect(refused.status()).toBe(422);
  expect((await refused.json()).error.fields).toEqual({
    depositPercent: ["give either a percentage or a fixed amount"],
  });
});
