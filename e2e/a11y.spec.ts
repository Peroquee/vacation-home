import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { withE2eDb } from "./database";

/**
 * Accessibility: axe on the main pages with real content in them, and the
 * booking flow done with the keyboard alone, starting from the calendar.
 */

const today = new Date().toISOString().slice(0, 10);
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("DELETE FROM transactions");
    await db.query("DELETE FROM blocks");
    await db.query("DELETE FROM bookings");
    await db.query("DELETE FROM guests");
    await db.query("DELETE FROM properties");
  });
});

/** A property with a stay, an inquiry, a block and some ledger entries this month. */
async function seed(page: Page) {
  const { request } = page;
  const property = await (
    await request.post("/api/properties", {
      data: {
        name: "Lake House",
        timezone: "Europe/Lisbon",
        currency: "EUR",
        defaultNightlyRateMinor: 10_000,
      },
    })
  ).json();
  const guest = await (
    await request.post("/api/guests", { data: { name: "Ada Lovelace" } })
  ).json();
  const book = (checkIn: string, checkOut: string, status: string) =>
    request.post("/api/bookings", {
      data: { propertyId: property.id, guestId: guest.id, checkIn, checkOut, status },
    });
  const first = `${today.slice(0, 7)}-01`;
  expect((await book(addDays(first, 2), addDays(first, 5), "confirmed")).ok()).toBe(true);
  expect((await book(addDays(first, 8), addDays(first, 10), "inquiry")).ok()).toBe(true);
  await request.post("/api/blocks", {
    data: {
      propertyId: property.id,
      startDate: addDays(first, 12),
      endDate: addDays(first, 14),
      reason: "Painting",
    },
  });
  const categories = await (await request.get("/api/categories?type=expense")).json();
  await request.post("/api/transactions", {
    data: {
      propertyId: property.id,
      type: "expense",
      categoryId: categories[0].id,
      amountMinor: 4_500,
      date: first,
      description: "Cleaning",
    },
  });
  return property;
}

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  // The ids and targets, so a failure says what to fix.
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) })),
  ).toEqual([]);
}

for (const path of ["/calendar", "/finance", "/dashboard", "/bookings"]) {
  test(`${path} has no automatically detectable accessibility problems`, async ({ page }) => {
    await seed(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Streamed widgets have arrived when no skeleton is left.
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expectNoViolations(page);
  });
}

/** Presses Tab until the focused element matches, as a keyboard user would. */
async function tabUntil(page: Page, matches: () => Promise<boolean>, limit = 60) {
  for (let i = 0; i < limit; i++) {
    if (await matches()) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("The control was not reachable with Tab");
}

const focused = (page: Page) => page.locator(":focus");

test("a booking can be made with the keyboard alone, from the calendar", async ({ page }) => {
  const property = await (
    await page.request.post("/api/properties", {
      data: { name: "Lake House", timezone: "Europe/Lisbon", currency: "EUR" },
    })
  ).json();
  await page.goto("/calendar");

  // Into the calendar: the roving focus lands on today.
  await tabUntil(page, async () => (await focused(page).getAttribute("data-date")) === today);
  // Select three nights, staying inside the month on screen.
  const towardsEnd = Number(today.slice(8)) <= 20;
  await page.keyboard.press("Enter");
  for (let i = 0; i < 3; i++) await page.keyboard.press(towardsEnd ? "ArrowRight" : "ArrowLeft");
  await page.keyboard.press("Enter");

  // The range offers a new booking.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await tabUntil(page, async () => (await focused(page).textContent()) === "New booking");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/bookings/new\\?propertyId=${property.id}`));

  // The guest, added inline.
  await tabUntil(page, async () => (await focused(page).textContent())?.trim() === "New guest");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Name")).toBeFocused();
  await page.keyboard.type("Grace Hopper");
  await page.keyboard.press("Enter");
  // The new guest is now the booking's guest, shown in the guest search box.
  await expect(page.getByRole("combobox", { name: "Guest" })).toHaveValue("Grace Hopper");

  // And save.
  await tabUntil(page, async () => (await focused(page).textContent()) === "Add booking");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Grace Hopper" })).toBeVisible();
});
