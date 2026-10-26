import { expect, test } from "@playwright/test";

import { withE2eDb } from "./database";
import { day } from "./dates";

// Seasonal prices (GitLab #118), on the built server: the owner adds a
// season in settings, sees where it applies, and a stay crossing its start
// is priced per night - by the booking API and the public estimate's rules
// alike.

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    // Booking income is on (GitLab #137): bookings have ledger entries.
    await db.query("DELETE FROM transactions WHERE booking_id IS NOT NULL");
    await db.query("DELETE FROM bookings");
    await db.query("DELETE FROM guests");
    await db.query("UPDATE properties SET publicly_listed = false");
    await db.query("DELETE FROM properties");
  });
});

test("a season set in settings prices the nights it covers", async ({ page, request }) => {
  const property = (await (
    await request.post("/api/properties", {
      data: {
        name: "Season Lake",
        timezone: "UTC",
        currency: "EUR",
        defaultNightlyRateMinor: 10_000,
        defaultCleaningFeeMinor: 5_000,
        slug: "season-lake",
        publiclyListed: true,
      },
    })
  ).json()) as { id: string };

  // From day 32 to day 45, every year.
  const [start, end] = [day(32), day(45)];
  // From settings to the property's own prices page.
  await page.goto("/settings");
  await page.getByRole("link", { name: "Prices of Season Lake" }).click();
  await expect(page).toHaveURL(new RegExp(`/settings/properties/${property.id}/pricing$`));
  const section = page.locator("#seasons");
  await section.getByRole("button", { name: "Add season" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Hauptsaison");
  await dialog.getByLabel("First day: day").fill(String(Number(start.slice(8))));
  await dialog.getByLabel("First day: month").selectOption(String(Number(start.slice(5, 7))));
  await dialog.getByLabel("Last day: day").fill(String(Number(end.slice(8))));
  await dialog.getByLabel("Last day: month").selectOption(String(Number(end.slice(5, 7))));
  await dialog.getByLabel("Nightly rate (EUR)").fill("140");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(section).toContainText("Hauptsaison · €140.00");
  // The strip names it in the month it starts.
  await expect(section.getByText(/Hauptsaison €140\.00/).first()).toBeVisible();

  // An overlapping one is refused, naming the season in the way.
  await section.getByRole("button", { name: "Add season" }).click();
  await dialog.getByLabel("Name").fill("Spät");
  await dialog.getByLabel("First day: day").fill(String(Number(end.slice(8))));
  await dialog.getByLabel("First day: month").selectOption(String(Number(end.slice(5, 7))));
  await dialog.getByLabel("Nightly rate (EUR)").fill("150");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toContainText("overlaps another season: Hauptsaison");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // From 4 nights 10% off; guests see it by the price.
  const discounts = page.locator("#discounts");
  await discounts.getByRole("button", { name: "Edit discounts" }).click();
  await dialog.getByRole("button", { name: "Add tier" }).click();
  await dialog.getByLabel("Tier 1: nights").fill("4");
  await dialog.getByLabel("Tier 1: percent off").fill("10");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(discounts).toContainText("From 4 nights 10% off");

  // Two nights before it, two in it.
  const guest = await (await request.post("/api/guests", { data: { name: "Ada" } })).json();
  const booking = await (
    await request.post("/api/bookings", {
      data: { propertyId: property.id, guestId: guest.id, checkIn: day(30), checkOut: day(34) },
    })
  ).json();
  // 480.00 nights, 10% off, 50.00 cleaning.
  expect(booking.totalAmountMinor).toBe(48_000 - 4_800 + 5_000);
  expect(booking.priceBreakdown.discount).toEqual({
    minNights: 4,
    percent: 10,
    amountMinor: 4_800,
  });
  expect(booking.priceBreakdown.nights).toEqual([
    { season: null, nights: 2, rateMinor: 10_000, amountMinor: 20_000 },
    { season: "Hauptsaison", nights: 2, rateMinor: 14_000, amountMinor: 28_000 },
  ]);

  // The public estimate gets the same rules.
  const availability = await (
    await request.get(
      `/api/public/properties/season-lake/availability?from=${day(30)}&to=${day(40)}`,
    )
  ).json();
  expect(availability.pricing.seasons).toEqual([
    expect.objectContaining({ name: "Hauptsaison", rateMinor: 14_000 }),
  ]);
  expect(availability.pricing.discounts).toEqual([{ minNights: 4, percent: 10 }]);
  expect(JSON.stringify(availability)).not.toContain("Season Lake");
  const visitor = await page
    .context()
    .browser()!
    .newContext({
      storageState: { cookies: [], origins: [] },
    });
  const publicPage = await visitor.newPage();
  await publicPage.goto("/stay/season-lake");
  await expect(publicPage.getByText("From 4 nights 10% off")).toBeVisible();
  await visitor.close();

  // The booking's page shows the lines.
  await page.goto(`/bookings/${booking.id}`);
  await expect(page.getByText(/^2 nights × €140\.00/)).toContainText("Hauptsaison");
  await expect(page.getByText("Discount from 4 nights −10%")).toBeVisible();
});
