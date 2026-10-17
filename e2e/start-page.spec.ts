import { type APIRequestContext, expect, test } from "@playwright/test";

import { STORAGE_STATE, withE2eDb } from "./database";

// The public start page (GitLab #117): a guest at the domain's root sees
// the listed homes - one goes straight to its page, several are cards -
// while the owner, signed in, still lands on the calendar.

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("UPDATE properties SET publicly_listed = false");
    await db.query("DELETE FROM property_listings");
    await db.query("DELETE FROM properties");
  });
});

async function listed(request: APIRequestContext, name: string, slug: string, title: string) {
  const property = (await (
    await request.post("/api/properties", {
      data: {
        name,
        timezone: "Europe/Berlin",
        currency: "EUR",
        defaultNightlyRateMinor: 14_000,
        slug,
        publiclyListed: true,
      },
    })
  ).json()) as { id: string };
  const saved = await request.put(`/api/properties/${property.id}/listing`, {
    data: {
      titleEn: title,
      titleDe: `${title} (de)`,
      descriptionEn: `A quiet home by the water. ${"Long walks and calm evenings. ".repeat(10)}`,
      location: "Seedorf",
    },
  });
  expect(saved.status()).toBe(200);
  return property;
}

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("several homes are cards, each leading to its page", async ({ page, playwright }) => {
    const owner = await playwright.request.newContext({ storageState: STORAGE_STATE });
    await listed(owner, "Internal Lake Name", "start-lake", "Lake Cottage");
    await listed(owner, "Internal Sea Name", "start-sea", "Sea Loft");
    await owner.dispose();

    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Our holiday homes");
    const cards = page.getByRole("article");
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText("Lake Cottage");
    await expect(cards.first()).toContainText("Seedorf");
    await expect(cards.first()).toContainText("From €140.00 per night");
    // A short description, cut at a word.
    await expect(cards.first()).toContainText(/A quiet home by the water\..*…/);
    // Never the owner's own names for them.
    await expect(page.getByText(/Internal/)).toHaveCount(0);

    // The footer: the legal pages, and the owner's way in.
    await expect(page.getByRole("link", { name: "Imprint" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Owner sign-in" })).toHaveAttribute(
      "href",
      "/signin",
    );

    await page.getByRole("link", { name: "Sea Loft" }).click();
    await expect(page).toHaveURL(/\/stay\/start-sea$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sea Loft");
  });

  test("a single home is shown straight away, in the visitor's language", async ({
    page,
    playwright,
    browser,
  }) => {
    const owner = await playwright.request.newContext({ storageState: STORAGE_STATE });
    await listed(owner, "Internal Lake Name", "start-lake", "Lake Cottage");
    await owner.dispose();

    await page.goto("/");
    await expect(page).toHaveURL(/\/stay\/start-lake$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lake Cottage");

    const german = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      locale: "de-DE",
    });
    const germanPage = await german.newPage();
    await germanPage.goto("/");
    await expect(germanPage.getByRole("heading", { level: 1 })).toHaveText("Lake Cottage (de)");
    await expect(germanPage.getByRole("link", { name: "Anmeldung für Gastgeber" })).toBeVisible();
    await german.close();
  });

  test("with nothing listed, a neutral note", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Coming soon");
    await expect(page.getByRole("link", { name: "Owner sign-in" })).toBeVisible();
  });
});

test("the owner, signed in, still lands on the calendar", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/calendar/);
});
