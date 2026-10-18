import { expect, test } from "@playwright/test";

import { withE2eDb } from "./database";

// The Kurtaxe (GitLab #120), on the built server: the owner sets the rules
// on the property's Prices page, a booking for a family gets its Kurtaxe
// line, and the Kurtaxe report shows what is owed for it.

const today = new Date().toISOString().slice(0, 10);
function day(offset: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("DELETE FROM transactions WHERE booking_id IS NOT NULL");
    await db.query("DELETE FROM bookings");
    await db.query("DELETE FROM guests");
    await db.query("UPDATE properties SET publicly_listed = false");
    await db.query("DELETE FROM properties");
  });
});

test("the Kurtaxe set on the Prices page is its own line, and the report counts it", async ({
  page,
  request,
}) => {
  const property = (await (
    await request.post("/api/properties", {
      data: {
        name: "Tax Lake",
        timezone: "UTC",
        currency: "EUR",
        defaultNightlyRateMinor: 10_000,
        defaultCleaningFeeMinor: 5_000,
      },
    })
  ).json()) as { id: string };

  await page.goto(`/settings/properties/${property.id}/pricing`);
  const card = page.locator("#tourist-tax");
  await expect(card).toContainText("No Kurtaxe.");
  await card.getByRole("button", { name: "Edit Kurtaxe" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: "Charge a Kurtaxe" }).click();
  await dialog.getByLabel("Per adult and night (EUR)").fill("3");
  await dialog.getByRole("button", { name: "Add age group" }).click();
  await dialog.getByLabel("Group 1: from age").fill("6");
  await dialog.getByLabel("Group 1: to age").fill("15");
  await dialog.getByLabel("Group 1: rate per night (EUR)").fill("1.50");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(card).toContainText("€3.00 per adult and night");
  await expect(card).toContainText("Ages 6–15: €1.50");
  await expect(card).toContainText('Shown as "plus Kurtaxe"');

  // Two adults and a child of 8, four nights from day 20.
  const checkIn = day(20);
  const guest = await (await request.post("/api/guests", { data: { name: "Ada" } })).json();
  const booking = await (
    await request.post("/api/bookings", {
      data: {
        propertyId: property.id,
        guestId: guest.id,
        checkIn,
        checkOut: day(24),
        status: "confirmed",
        guestSplit: { adults: 2, children: [{ fromAge: 6, toAge: 15, count: 1 }] },
      },
    })
  ).json();
  // 400.00 + 50.00 cleaning + 2 x 4 x 3.00 + 4 x 1.50.
  expect(booking).toMatchObject({
    guestCount: 3,
    touristTaxMinor: 3_000,
    totalAmountMinor: 48_000,
  });

  await page.goto(`/bookings/${booking.id}`);
  await expect(page.getByText("2 adults, 1 child aged 6–15")).toBeVisible();
  await expect(page.getByText("Kurtaxe: 2 adults × 4 nights × €3.00")).toBeVisible();
  await expect(page.getByText("Kurtaxe: 1 child aged 6–15 × 4 nights × €1.50")).toBeVisible();

  // The report: owed by the month the stay starts in.
  const year = checkIn.slice(0, 4);
  await page.goto(`/finance/tourist-tax?year=${year}`);
  await expect(page.getByRole("heading", { name: `Kurtaxe ${year}` })).toBeVisible();
  const footer = page.locator("tfoot");
  await expect(footer).toContainText("€30.00");
});
