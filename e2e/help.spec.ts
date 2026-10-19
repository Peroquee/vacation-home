import { expect, test } from "@playwright/test";

import { STORAGE_STATE, withE2eDb } from "./database";

// The help panel (GitLab #121): on every owner page a help button opens
// that page's help in the user's language, with a link to the matching
// section of the user guide; guests see how booking works.

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("UPDATE properties SET publicly_listed = false");
    await db.query("DELETE FROM properties");
  });
});

test("the help button opens the page's own help, and leads on to the guide", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/bookings/requests");
  await page.getByRole("button", { name: "Help for this page" }).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByRole("heading", { name: "Requests", level: 2 })).toBeVisible();
  await expect(panel).toContainText("Accept and reserve");
  // The conditional parts are resolved: no markers are ever shown.
  await expect(panel).not.toContainText(":::");

  await panel.getByRole("link", { name: "More in the user guide" }).click();
  await expect(page).toHaveURL(/\/help#bookings$/);
  await expect(page.locator("#bookings")).toBeVisible();

  // Another page, another help: the panel follows the page you are on.
  await page.goto("/settings");
  await page.getByRole("button", { name: "Help for this page" }).click();
  await expect(page.getByRole("dialog")).toContainText("Change a booking rule");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("the help speaks the user's language", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    locale: "de-DE",
    storageState: STORAGE_STATE,
    baseURL,
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Hilfe zu dieser Seite" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Kalender" })).toBeVisible();
  await context.close();
});

test.describe("guests", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("see how booking works on the home's page", async ({ page, playwright, baseURL }) => {
    const owner = await playwright.request.newContext({
      baseURL,
      storageState: STORAGE_STATE,
    });
    await owner.post("/api/properties", {
      data: {
        name: "Help Lake",
        timezone: "UTC",
        currency: "EUR",
        defaultNightlyRateMinor: 10_000,
        slug: "help-lake",
        publiclyListed: true,
      },
    });
    await owner.dispose();
    await page.goto("/stay/help-lake");
    const box = page.getByRole("region", { name: "How booking works" });
    await expect(box.getByRole("listitem")).toHaveCount(4);
    await expect(box).toContainText("Deposit: you transfer the deposit by the deadline given.");
  });
});
