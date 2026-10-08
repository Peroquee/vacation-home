import { expect, test } from "@playwright/test";

import { createSession, E2E_USER, sessionCookie, withE2eDb } from "./database";

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("pages redirect to sign-in and remember where they were going", async ({ page }) => {
    await page.goto("/bookings?status=confirmed");
    await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Fbookings%3Fstatus%3Dconfirmed$/);
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    // No app shell before signing in.
    await expect(page.getByRole("navigation")).toHaveCount(0);
  });

  test("API calls get a 401, not a redirect", async ({ request }) => {
    for (const path of ["/api/properties", "/api/guests", "/api/debug/error"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(401);
      expect((await response.json()).error.code).toBe("unauthorized");
    }
  });

  test("a refused account sees a clear message", async ({ page }) => {
    await page.goto("/signin?error=AccessDenied");
    // Scoped to the page content: Next's route announcer is an alert too.
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      /isn't allowed to use this app/,
    );
  });

  test("the sign-in page will not redirect off-site", async ({ page }) => {
    await page.goto("/signin?callbackUrl=//evil.example/steal");
    await expect(page.locator('input[name="callbackUrl"]')).toHaveValue("/calendar");
  });

  test("a session for an address no longer on the allow-list is revoked", async ({
    page,
    context,
    baseURL,
  }) => {
    const token = await createSession({ name: "Former", email: "former@example.test" });
    await context.addCookies([sessionCookie(token, baseURL!)]);

    await page.goto("/calendar");
    await expect(page).toHaveURL(/\/signin/);

    const { rowCount } = await withE2eDb((db) =>
      db.query("SELECT 1 FROM sessions WHERE session_token = $1", [token]),
    );
    expect(rowCount).toBe(0);
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "authjs.session-token")).toBeUndefined();
  });
});

test("a signed-in user sees the app and their account", async ({ page }) => {
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Account menu for ${E2E_USER.name}` }).first(),
  ).toBeVisible();
});

test("a signed-in user is sent on from the sign-in page, but never off-site", async ({ page }) => {
  await page.goto("/signin?callbackUrl=/finance");
  await expect(page).toHaveURL(/\/finance$/);

  // Browsers drop tabs while parsing a URL, so this would mean //evil.example.
  await page.goto("/signin?callbackUrl=%2F%09%2Fevil.example");
  await expect(page).toHaveURL(/^http:\/\/localhost:3100\/calendar$/);
});

test.describe("signing out", () => {
  // Its own session, so signing out does not end the one other tests share.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("ends the session in the database and returns to sign-in", async ({
    page,
    context,
    baseURL,
  }) => {
    const token = await createSession(E2E_USER);
    await context.addCookies([sessionCookie(token, baseURL!)]);

    await page.goto("/calendar");
    await page
      .getByRole("button", { name: `Account menu for ${E2E_USER.name}` })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();

    await expect(page).toHaveURL(/\/signin$/);
    const { rowCount } = await withE2eDb((db) =>
      db.query("SELECT 1 FROM sessions WHERE session_token = $1", [token]),
    );
    expect(rowCount).toBe(0);

    await page.goto("/calendar");
    await expect(page).toHaveURL(/\/signin/);
  });
});
