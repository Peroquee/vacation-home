import { type APIRequestContext, expect, test } from "@playwright/test";

import { withE2eDb } from "./database";
import { day } from "./dates";

// Payment recording (GitLab #115): the owner enters bank details, gives the
// guest a link to their booking - amount, deadline, IBAN, GiroCode - and
// records the deposit when it arrives, which confirms the booking and
// enters it in the ledger once.

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("DELETE FROM transactions WHERE booking_id IS NOT NULL");
    await db.query("DELETE FROM booking_payments");
    await db.query("DELETE FROM bookings");
    await db.query("DELETE FROM guests");
    await db.query("DELETE FROM properties");
  });
});

/** A reserved booking: 4 nights at 250.00 + 100.00 cleaning, so a 220.00 deposit. */
async function reserved(request: APIRequestContext) {
  const property = (await (
    await request.post("/api/properties", {
      data: {
        name: "Pay Lake",
        timezone: "UTC",
        currency: "EUR",
        defaultNightlyRateMinor: 25_000,
        defaultCleaningFeeMinor: 10_000,
      },
    })
  ).json()) as { id: string };
  const guest = await (await request.post("/api/guests", { data: { name: "Ada" } })).json();
  const booking = await (
    await request.post("/api/bookings", {
      data: { propertyId: property.id, guestId: guest.id, checkIn: day(60), checkOut: day(64) },
    })
  ).json();
  expect((await request.post(`/api/bookings/${booking.id}/reserve`)).status()).toBe(200);
  return { property, booking: booking as { id: string } };
}

test("bank details are checked and kept per property", async ({ request, page }) => {
  const { property } = await reserved(request);
  expect(
    await (await request.get(`/api/properties/${property.id}/bank-details`)).json(),
  ).toBeNull();

  await page.goto("/settings");
  await page.getByRole("button", { name: "Edit the bank details of Pay Lake" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Account holder").fill("Ada Lovelace");
  await dialog.getByLabel("IBAN").fill("DE89 3704 0044 0532 0130 01");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText("IBAN must be a valid IBAN")).toBeVisible();
  await dialog.getByLabel("IBAN").fill("de89 3704 0044 0532 0130 00");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#bank-details")).toContainText(
    "Ada Lovelace · DE89 3704 0044 0532 0130 00",
  );
  expect(await (await request.get(`/api/properties/${property.id}/bank-details`)).json()).toEqual({
    accountHolder: "Ada Lovelace",
    iban: "DE89370400440532013000",
    bic: null,
    bankName: null,
  });
});

test("the guest sees what to pay; the owner records the deposit, once in the ledger", async ({
  request,
  page,
  browser,
}) => {
  const { property, booking } = await reserved(request);
  await request.put(`/api/properties/${property.id}/bank-details`, {
    data: { accountHolder: "Ada Lovelace", iban: "DE89370400440532013000", bic: "COBADEFFXXX" },
  });

  await page.goto(`/bookings/${booking.id}`);
  await page.getByRole("button", { name: "Guest link" }).click();
  const link = await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Guest link" })
    .inputValue();
  expect(link).toMatch(/\/stay\/booking\/[A-Za-z0-9_-]{22}$/);
  await page.keyboard.press("Escape");

  const guest = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const guestPage = await guest.newPage();
  const response = await guestPage.goto(new URL(link).pathname);
  expect(response!.status()).toBe(200);
  await expect(guestPage.getByRole("heading", { level: 2 }).first()).toHaveText(
    "Reserved for you: awaiting your payment",
  );
  await expect(guestPage.getByText(/Please pay the deposit of €220.00 by/)).toBeVisible();
  await expect(guestPage.getByText("DE89 3704 0044 0532 0130 00")).toBeVisible();
  // The reference to quote; the guests' help (GitLab #127) names it too.
  await expect(
    guestPage
      .getByRole("definition")
      .filter({ hasText: /^Booking [A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/ }),
  ).toBeVisible();
  const girocode = guestPage.getByRole("img", { name: /GiroCode/ });
  await expect(girocode).toBeVisible();
  expect(await girocode.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  // Never indexed, never in a referrer.
  await expect(guestPage.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(guestPage.locator('meta[name="referrer"]')).toHaveAttribute(
    "content",
    "no-referrer",
  );

  await page.getByRole("button", { name: "Record payment" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Amount (EUR)")).toHaveValue("220.00");
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(page.getByText("Received €220.00 of €1,100.00")).toBeVisible();

  const entries = await withE2eDb(
    async (db) =>
      (
        await db.query<{ type: string; amount_minor: number }>(
          "SELECT type, amount_minor FROM transactions WHERE booking_id = $1",
          [booking.id],
        )
      ).rows,
  );
  expect(entries).toEqual([{ type: "income", amount_minor: 22_000 }]);

  await guestPage.reload();
  await expect(guestPage.getByRole("heading", { level: 2 }).first()).toHaveText("Confirmed");
  await expect(guestPage.getByText(/Please pay the balance of €880.00 by/)).toBeVisible();

  // A link that was never given out opens nothing.
  expect((await guest.request.get("/stay/booking/AAAAAAAAAAAAAAAAAAAAAA")).status()).toBe(404);
  await guest.close();
});
