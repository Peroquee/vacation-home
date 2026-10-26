import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import { withE2eDb } from "./database";

// The guests' help on the public pages (GitLab #127): the property page
// explains how booking works with the property's own terms, the guest's
// booking page what its status means and what to do next. In the visitor's
// language, folded in <details> that open by mouse and keyboard alike, and
// still without a single cookie.

const today = new Date().toISOString().slice(0, 10);
function day(offset: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("DELETE FROM booking_payments");
    // Booking income is on (GitLab #137): bookings have ledger entries.
    await db.query("DELETE FROM transactions WHERE booking_id IS NOT NULL");
    await db.query("DELETE FROM bookings");
    await db.query("DELETE FROM guests");
    await db.query("DELETE FROM properties");
  });
});

/** A guest's browser: no session, the given language. */
async function guestPage(browser: Browser, locale: "en-GB" | "de-DE") {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    locale,
  });
  return { context, page: await context.newPage() };
}

/** Opens `path` and checks the response set no cookie. */
async function open(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response!.status()).toBe(200);
  const cookies = (await response!.headersArray()).filter(
    (header) => header.name.toLowerCase() === "set-cookie",
  );
  expect(cookies, path).toEqual([]);
}

/** With every question open, no accessibility problem axe finds, contrast included, in both themes. */
async function expectAccessible(page: Page, help: string) {
  await page.evaluate(() => {
    for (const details of document.querySelectorAll("details")) details.open = true;
  });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const results = await new AxeBuilder({ page })
      .include(`section[aria-labelledby="${help}"]`)
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) })),
      colorScheme,
    ).toEqual([]);
  }
}

test("the property page and the booking page explain booking with the real terms", async ({
  request,
  browser,
}) => {
  const property = (await (
    await request.post("/api/properties", {
      data: {
        name: "Help Bay",
        timezone: "UTC",
        currency: "EUR",
        defaultNightlyRateMinor: 25_000,
        slug: "help-bay",
        publiclyListed: true,
      },
    })
  ).json()) as { id: string };
  expect(
    (
      await request.put(`/api/properties/${property.id}/payment-terms`, {
        data: {
          depositPercent: 30,
          depositFixedMinor: null,
          depositDueDays: 10,
          balanceDueDaysBefore: 30,
          fullPaymentDueDays: 3,
        },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.put(`/api/properties/${property.id}/stay-times`, {
        data: { checkInTime: "15:00", earliestCheckOutTime: null, checkOutTime: "10:00" },
      })
    ).status(),
  ).toBe(200);
  await request.put(`/api/properties/${property.id}/bank-details`, {
    data: {
      accountHolder: "Ada Lovelace",
      iban: "DE89370400440532013000",
      bic: null,
      bankName: null,
    },
  });

  // The property page, in English.
  const en = await guestPage(browser, "en-GB");
  await open(en.page, "/stay/help-bay");
  const help = en.page.getByRole("region", { name: "How booking works" });
  await expect(help).toContainText(
    "you transfer the deposit of 30% of the total within 10 days of our acceptance",
  );
  // Folded until asked, by mouse ...
  const times = help.locator("details", { hasText: "Arrival and departure" });
  await expect(times.getByText("Arrival from 15:00 · Departure by 10:00")).toBeHidden();
  await times.locator("summary").click();
  await expect(times.getByText("Arrival from 15:00 · Departure by 10:00")).toBeVisible();
  // ... or by keyboard.
  const pay = help.locator("details", { hasText: "How do I pay?" });
  await pay.locator("summary").focus();
  await en.page.keyboard.press("Enter");
  await expect(pay).toHaveAttribute("open", "");
  await expect(pay).toContainText("scan it with your banking app");
  // No Kurtaxe set: nothing said about one.
  await expect(help).not.toContainText("Kurtaxe");
  await expectAccessible(en.page, "how-it-works");
  await en.context.close();

  // In German.
  const de = await guestPage(browser, "de-DE");
  await open(de.page, "/stay/help-bay");
  const hilfe = de.page.getByRole("region", { name: "So funktioniert die Buchung" });
  await expect(hilfe).toContainText(
    "Sie überweisen die Anzahlung von 30 % des Gesamtpreises innerhalb von 10 Tagen nach unserer Zusage",
  );

  // A reservation, and the guest's own page.
  const guest = await (await request.post("/api/guests", { data: { name: "Ada" } })).json();
  const booking = await (
    await request.post("/api/bookings", {
      data: { propertyId: property.id, guestId: guest.id, checkIn: day(60), checkOut: day(64) },
    })
  ).json();
  expect((await request.post(`/api/bookings/${booking.id}/reserve`)).status()).toBe(200);
  const { url } = await (await request.post(`/api/bookings/${booking.id}/guest-link`)).json();
  const path = new URL(url).pathname;

  await open(de.page, path);
  const weiter = de.page.getByRole("region", { name: "Wie es weitergeht" });
  // 30% of 4 × 250.00.
  await expect(weiter).toContainText(/Ihr nächster Schritt: Überweisen Sie 300,00\s€ bis/);
  await de.context.close();

  const own = await guestPage(browser, "en-GB");
  await open(own.page, path);
  const next = own.page.getByRole("region", { name: "What happens now" });
  await expect(next).toContainText(/Your next step: transfer €300\.00 by/);
  await next.locator("summary", { hasText: "How do I pay?" }).click();
  await expect(next).toContainText(/Please quote Booking [A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}/);
  await next.locator("summary", { hasText: "How do I add the stay to my calendar?" }).click();
  await expect(next).toContainText("Add to calendar (.ics)");
  await expectAccessible(own.page, "booking-help");
  await own.context.close();
});
