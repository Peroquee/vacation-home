/**
 * Every main page, admin and public, as the UX review (GitLab #132) looks at
 * it: phone and desktop, light and dark, German. Run by
 * `npm run ux:screenshots` (playwright.ux.config.ts) against the data of
 * scripts/ux/seed.ts; the pictures land in docs/ux-review/screens/.
 *
 * "Dark" adds the `dark` class the stylesheet's dark tokens hang on. Nothing
 * in the app sets it yet, so those pictures preview the dark tokens rather
 * than show what a user sees.
 */
import { test } from "@playwright/test";

import { createSession, E2E_USER, sessionCookie } from "../database";
import { type Seeded, seeded, shoot, VARIANTS } from "./shared";

function adminPages(s: Seeded): [string, string][] {
  return [
    ["admin-calendar", "/calendar"],
    ["admin-bookings", "/bookings"],
    ["admin-requests", "/bookings/requests"],
    ["admin-booking-new", "/bookings/new"],
    ["admin-booking-current", `/bookings/${s.bookings.current}`],
    ["admin-booking-reserved", `/bookings/${s.bookings.reserved}`],
    ["admin-booking-confirmed", `/bookings/${s.bookings.confirmed}`],
    ["admin-booking-cancelled", `/bookings/${s.bookings.cancelled}`],
    ["admin-booking-edit", `/bookings/${s.bookings.confirmed}/edit`],
    ["admin-guest", `/guests/${s.guest}`],
    ["admin-finance", "/finance"],
    ["admin-finance-recurring", "/finance/recurring"],
    ["admin-finance-tourist-tax", "/finance/tourist-tax"],
    ["admin-finance-categories", "/finance/categories"],
    ["admin-finance-import", "/finance/import"],
    ["admin-dashboard", "/dashboard"],
    ["admin-settings", "/settings"],
    ["admin-listing", `/settings/properties/${s.lake.id}/listing`],
    ["admin-pricing", `/settings/properties/${s.cabin.id}/pricing`],
    ["admin-help", "/help"],
  ];
}

function publicPages(s: Seeded): [string, string][] {
  return [
    ["public-start", "/stay"],
    ["public-property", `/stay/${s.lake.slug}`],
    ["public-property-cabin", `/stay/${s.cabin.slug}`],
    ["public-guest-page", s.guestPath],
    ["public-imprint", "/stay/legal/imprint"],
    ["public-privacy", "/stay/legal/privacy"],
    ["public-signin", "/signin"],
  ];
}

for (const variant of VARIANTS) {
  test.describe(variant.name, () => {
    test.use({ viewport: variant.viewport });

    test("public pages", async ({ page }) => {
      for (const [name, path] of publicPages(seeded())) {
        await page.goto(path);
        await shoot(page, `${variant.name}/${name}`, variant.dark);
      }
    });

    test("admin pages", async ({ page, context, baseURL }) => {
      await context.addCookies([sessionCookie(await createSession(E2E_USER), baseURL!)]);
      for (const [name, path] of adminPages(seeded())) {
        await page.goto(path);
        // The help page is the whole user guide: its first screen will do.
        await shoot(page, `${variant.name}/${name}`, variant.dark, name !== "admin-help");
      }
    });
  });
}
