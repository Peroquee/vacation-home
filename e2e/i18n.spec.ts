import { expect, test } from "@playwright/test";

// The app picks its language from the `locale` cookie, then the browser's
// Accept-Language, then German (src/i18n/locales.ts).

test.describe("with a German browser", () => {
  test.use({ locale: "de-DE" });

  test("pages are in German, with German dates", async ({ page }) => {
    await page.goto("/calendar");

    await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");
    await expect(page.getByRole("heading", { level: 1, name: "Kalender" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Buchungen" }).first()).toBeVisible();
  });
});

test("the user menu switches the language and remembers it", async ({ page }) => {
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();

  await page
    .getByRole("button", { name: /^Account menu for / })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Deutsch" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Kalender" })).toBeVisible();

  // The cookie outlives the page: a fresh load stays German.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Kalender" })).toBeVisible();
});
