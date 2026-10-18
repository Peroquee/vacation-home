import { expect, test } from "@playwright/test";

import { createSession, sessionCookie, withE2eDb } from "./database";

// Who may sign in, managed in the app (GitLab #122): the owner adds an
// account in Settings -> Access, it can use the app; removed, its session
// ends at once. A refused sign-in explains itself.

const FRIEND = { name: "Friend", email: "friend@e2e.example.test" };

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("DELETE FROM allowed_accounts");
    await db.query(
      "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = $1)",
      [FRIEND.email],
    );
  });
});

test("an account added in settings can use the app, and loses it when removed", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto("/settings#access");
  const access = page.locator("#access");
  await expect(access).toContainText("e2e-owner@example.test");
  await expect(access).toContainText("Fixed in the server's settings");
  // The fixed account cannot be removed here.
  await expect(access.getByRole("button", { name: /Remove e2e-owner/ })).toHaveCount(0);

  await access.getByLabel("Google account (email address)").fill(FRIEND.email);
  await access.getByRole("button", { name: "Add account" }).click();
  await expect(access).toContainText(FRIEND.email);
  // Twice is refused, saying why.
  await access.getByLabel("Google account (email address)").fill(FRIEND.email);
  await access.getByRole("button", { name: "Add account" }).click();
  await expect(access).toContainText("This account may sign in already.");

  // The friend, signed in, gets in.
  const friend = await browser.newContext({
    storageState: {
      cookies: [sessionCookie(await createSession(FRIEND), baseURL!)],
      origins: [],
    },
  });
  const friendPage = await friend.newPage();
  await friendPage.goto("/calendar");
  await expect(friendPage).toHaveURL(/\/calendar/);

  // Removed: the session ends at once.
  await access.getByRole("button", { name: `Remove ${FRIEND.email}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(access).not.toContainText(FRIEND.email);
  await friendPage.goto("/calendar");
  await expect(friendPage).toHaveURL(/\/signin/);
  const left = await withE2eDb(
    async (db) =>
      (
        await db.query(
          "SELECT count(*)::int AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1",
          [FRIEND.email],
        )
      ).rows[0].n,
  );
  expect(left).toBe(0);
  await friend.close();
});

test.describe("a refused sign-in", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("names the account by its mask, and shows guests the way to book", async ({ page }) => {
    await page.goto(`/signin?error=AccessDenied&account=${encodeURIComponent("f…@gmail.com")}`);
    await expect(page.getByRole("alert")).toHaveText(
      "This Google account (f…@gmail.com) has no access. Ask the owner to add it.",
    );
    await expect(page.getByRole("link", { name: "see the holiday homes" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(
      page.getByRole("button", { name: "Sign in with another Google account" }),
    ).toBeVisible();
  });

  test("shows nothing of a URL's own text in place of the account", async ({ page }) => {
    await page.goto(`/signin?error=AccessDenied&account=${encodeURIComponent("Call 0800 now")}`);
    await expect(page.getByRole("alert")).not.toContainText("0800");
    await expect(page.getByRole("alert")).toContainText("isn't allowed to use this app");
  });
});
