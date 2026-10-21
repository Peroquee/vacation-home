import { expect, test } from "@playwright/test";

import { withE2eDb } from "./database";

// The cancellation policy (GitLab #116): the deposit is kept when a guest
// cancels, anything beyond it is refunded; the guest reads that next to the
// price before requesting. Cancelling frees the dates at once, and the
// refund is due until the owner records it, which puts it in the ledger.

const today = new Date().toISOString().slice(0, 10);
function day(offset: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("DELETE FROM transactions WHERE booking_id IS NOT NULL");
    await db.query("DELETE FROM booking_payments");
    await db.query("DELETE FROM bookings");
    await db.query("DELETE FROM guests");
    await db.query("DELETE FROM property_listings");
    await db.query("DELETE FROM properties");
  });
});

test("a guest's cancellation keeps the deposit, frees the dates and refunds the rest", async ({
  request,
  page,
  browser,
}) => {
  // 4 nights at 250.00 + 100.00 cleaning: 1100.00, a 20% deposit of 220.00.
  const property = (await (
    await request.post("/api/properties", {
      data: {
        name: "Cancel Lake",
        timezone: "UTC",
        currency: "EUR",
        defaultNightlyRateMinor: 25_000,
        defaultCleaningFeeMinor: 10_000,
        slug: "cancel-lake",
        publiclyListed: true,
      },
    })
  ).json()) as { id: string };

  // What the guest reads before requesting.
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const publicPage = await visitor.newPage();
  await publicPage.goto("/stay/cancel-lake");
  // Next to the price; the guests' help (GitLab #127) says it again further down.
  await expect(
    publicPage
      .locator("header")
      .getByText(
        "The deposit of 20% of the total is non-refundable if you cancel. Anything paid beyond the deposit is refunded in full.",
      ),
  ).toBeVisible();
  await visitor.close();

  const guest = await (await request.post("/api/guests", { data: { name: "Ada" } })).json();
  const booking = (await (
    await request.post("/api/bookings", {
      data: { propertyId: property.id, guestId: guest.id, checkIn: day(60), checkOut: day(64) },
    })
  ).json()) as { id: string };
  expect((await request.post(`/api/bookings/${booking.id}/reserve`)).status()).toBe(200);
  for (const [kind, amountMinor] of [
    ["deposit", 22_000],
    ["balance", 88_000],
  ] as const) {
    const paid = await request.post(`/api/bookings/${booking.id}/payments`, {
      data: { kind, amountMinor, receivedOn: today },
    });
    expect(paid.status()).toBe(201);
  }

  await page.goto(`/bookings/${booking.id}`);
  await page.getByRole("button", { name: "Cancel booking" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Refund (EUR)")).toHaveValue("880.00");
  await expect(dialog).toContainText("the deposit of €220.00 is kept");
  await dialog.getByRole("radio", { name: "You" }).check();
  await expect(dialog.getByLabel("Refund (EUR)")).toHaveValue("1100.00");
  await dialog.getByRole("radio", { name: "The guest" }).check();
  await dialog.getByRole("button", { name: "Cancel booking" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.getByText("Refund due: €880.00")).toBeVisible();

  // The dates are free at once.
  const rival = await request.post("/api/bookings", {
    data: {
      propertyId: property.id,
      guestId: guest.id,
      checkIn: day(60),
      checkOut: day(64),
      status: "confirmed",
    },
  });
  expect(rival.status()).toBe(201);

  // The refund, prefilled, once sent: no longer due, and in the ledger.
  await page.getByRole("button", { name: "Record payment" }).click();
  const payment = page.getByRole("dialog");
  await expect(payment.getByLabel("Kind")).toHaveValue("refund");
  await expect(payment.getByLabel("Amount (EUR)")).toHaveValue("880.00");
  await payment.getByRole("button", { name: "Record payment" }).click();
  await expect(payment).toBeHidden();
  await expect(page.getByText(/Refund due/)).toHaveCount(0);

  const ledger = await withE2eDb(async (db) =>
    (
      await db.query<{ amount_minor: number }>(
        "SELECT amount_minor FROM transactions WHERE booking_id = $1 ORDER BY amount_minor",
        [booking.id],
      )
    ).rows.map((r) => r.amount_minor),
  );
  expect(ledger).toEqual([-88_000, 22_000, 88_000]);
});

test("a refund schedule set on the Prices page is shown to guests", async ({
  page,
  request,
  browser,
}) => {
  const property = (await (
    await request.post("/api/properties", {
      data: {
        name: "Schedule Lake",
        timezone: "UTC",
        currency: "EUR",
        defaultNightlyRateMinor: 25_000,
        slug: "schedule-lake",
        publiclyListed: true,
      },
    })
  ).json()) as { id: string };

  await page.goto(`/settings/properties/${property.id}/pricing`);
  const card = page.locator("#refund-schedule");
  await card.getByRole("checkbox", { name: /Use a refund schedule/ }).click();
  // The defaults are the usual example: free until 6 months, 20% -> 100% over 5.
  await card.getByLabel("Example arrival").fill("2027-08-12");
  await expect(card).toContainText("Free cancellation until 12 February 2027.");
  await expect(card).toContainText("until 12 July 2027");
  await expect(card).toContainText("Cancelled on 13 February 2027: 20% of the deposit kept");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Refund schedule saved")).toBeVisible();

  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const publicPage = await visitor.newPage();
  await publicPage.goto("/stay/schedule-lake");
  await expect(
    publicPage.locator("header").getByText(/^Free cancellation up to 6 months before arrival\./),
  ).toBeVisible();
  await visitor.close();
});
