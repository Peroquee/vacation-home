import { expect, test } from "@playwright/test";

import { withE2eDb } from "./database";

// Recurring costs (GitLab #104): a rule added through the UI is listed with
// its amount, interval and next due date, and can be paused.

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("DELETE FROM transactions");
    await db.query("DELETE FROM recurring_expenses");
    await db.query("DELETE FROM properties");
  });
});

test("a recurring cost is added, listed and paused through the UI", async ({ page }) => {
  await page.request.post("/api/properties", {
    data: { name: "Lake House", timezone: "Europe/Berlin", currency: "EUR" },
  });

  await page.goto("/finance/recurring");
  await expect(page.getByRole("heading", { level: 1, name: "Recurring costs" })).toBeVisible();
  await page.getByRole("button", { name: "Add a recurring cost" }).first().click();

  const dialog = page.getByRole("dialog", { name: "Add a recurring cost" });
  await dialog.getByLabel("Category").selectOption({ index: 1 });
  await dialog.getByLabel("Amount").fill("950");
  await dialog.getByLabel("First due").fill("2099-01-01");
  await dialog.getByLabel("Description").fill("Mortgage instalment");
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog).toBeHidden();

  const row = page.getByRole("row", { name: /Mortgage instalment/ });
  await expect(row).toContainText("€950.00 a month");
  await expect(row).toContainText("1 Jan 2099");
  await expect(row).toContainText("Active");

  await row.getByRole("button", { name: "Pause Mortgage instalment" }).click();
  await expect(row).toContainText("Paused");
  await expect(row).toContainText("When resumed");
});
