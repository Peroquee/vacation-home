import { expect, test } from "@playwright/test";

import { withE2eDb } from "./database";

// Seasonal prices (GitLab #118), on the built server: the owner adds a
// season in settings, sees where it applies, and a stay crossing its start
// is priced per night - by the booking API and the public estimate's rules
// alike.

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
  await page.goto("/settings#seasons");
  const section = page.locator("#seasons");
  await section.getByRole("button", { name: "Add a season to Season Lake" }).click();
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
  await section.getByRole("button", { name: "Add a season to Season Lake" }).click();
  await dialog.getByLabel("Name").fill("Spät");
  await dialog.getByLabel("First day: day").fill(String(Number(end.slice(8))));
  await dialog.getByLabel("First day: month").selectOption(String(Number(end.slice(5, 7))));
  await dialog.getByLabel("Nightly rate (EUR)").fill("150");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toContainText("overlaps another season: Hauptsaison");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Two nights before it, two in it.
  const guest = await (await request.post("/api/guests", { data: { name: "Ada" } })).json();
  const booking = await (
    await request.post("/api/bookings", {
      data: { propertyId: property.id, guestId: guest.id, checkIn: day(30), checkOut: day(34) },
    })
  ).json();
  expect(booking.totalAmountMinor).toBe(2 * 10_000 + 2 * 14_000 + 5_000);
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
  expect(JSON.stringify(availability)).not.toContain("Season Lake");

  // The booking's page shows the lines.
  await page.goto(`/bookings/${booking.id}`);
  await expect(page.getByText(/^2 nights × €140\.00/)).toContainText("Hauptsaison");
});
