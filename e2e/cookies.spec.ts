import { expect, test } from "@playwright/test";

import { COOKIE_NAMES } from "../src/lib/legal/cookies";

import { STORAGE_STATE } from "./database";

// The cookie notice (GitLab #124) lists every cookie a browser gets from
// the app: guests none, the owner's sign-in and pages only the listed ones.

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a guest on the public pages gets no cookie, and the notice says so", async ({
    page,
    context,
  }) => {
    await page.goto("/stay/legal/privacy");
    await page.getByRole("link", { name: "Cookie notice" }).click();
    await expect(page).toHaveURL(/\/stay\/legal\/cookies$/);
    await expect(page.getByRole("heading", { name: "Cookie notice", level: 1 })).toBeVisible();
    await expect(page.getByRole("table")).toContainText("authjs.session-token");
    expect(await context.cookies()).toEqual([]);
  });

  test("the sign-in sets only listed cookies, and links the notice", async ({ page, context }) => {
    // Google itself is not reached from the test.
    await page.route(/accounts\.google\.com/, (route) => route.abort());
    await page.goto("/signin");
    await expect(page.getByRole("link", { name: "cookie notice" })).toHaveAttribute(
      "href",
      "/stay/legal/cookies",
    );
    await page.getByRole("button", { name: "Sign in with Google" }).click();
    await expect
      .poll(async () => (await context.cookies()).map((c) => c.name))
      .toContain("authjs.pkce.code_verifier");
    const names = (await context.cookies()).map((c) => c.name);
    expect(names.length).toBeGreaterThanOrEqual(3);
    for (const name of names) expect(COOKIE_NAMES, name).toContain(name);
  });
});

test("the owner's pages set only listed cookies", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ storageState: STORAGE_STATE, baseURL });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/calendar");
  // The language, chosen in the account menu.
  await page
    .getByRole("button", { name: /^Account menu for / })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Deutsch" }).click();
  await expect.poll(async () => (await context.cookies()).map((c) => c.name)).toContain("locale");
  for (const { name } of await context.cookies()) expect(COOKIE_NAMES, name).toContain(name);
  await context.close();
});
