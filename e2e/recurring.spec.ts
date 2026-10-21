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

// GitLab #130: found from the Finance tabs; the contract on the rule, and a
// receipt on one of its payments.
test("a recurring cost holds its contract, and each payment its receipt", async ({
  page,
  playwright,
  baseURL,
}) => {
  const property = await (
    await page.request.post("/api/properties", {
      data: { name: "Lake House", timezone: "Europe/Berlin", currency: "EUR" },
    })
  ).json();
  const [category] = await (await page.request.get("/api/categories?type=expense")).json();
  // Yearly since 2025: two payments made already.
  const created = await page.request.post("/api/recurring-expenses", {
    data: {
      propertyId: property.id,
      categoryId: category.id,
      amountMinor: 48_000,
      interval: "annual",
      startDate: "2025-01-01",
      description: "Building insurance",
    },
  });
  expect(created.status()).toBe(201);
  const rule = await created.json();
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");

  await page.goto("/finance");
  await page
    .getByRole("navigation", { name: "Finance" })
    .getByRole("link", { name: "Recurring costs" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Recurring costs" })).toBeVisible();
  await page.getByRole("button", { name: "Edit Building insurance" }).click();
  const dialog = page.getByRole("dialog");

  // The policy, on the rule.
  const documents = dialog.getByRole("region", { name: "Documents" });
  await expect(documents).toContainText("No documents yet");
  await documents
    .getByLabel("Add documents", { exact: true })
    .setInputFiles({ name: "Police.pdf", mimeType: "application/pdf", buffer: pdf });
  const link = documents.getByRole("link", { name: "Open Police.pdf" });
  await expect(link).toBeVisible();
  const file = await page.request.get((await link.getAttribute("href"))!);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-disposition"]).toMatch(/^attachment;/);
  expect(Buffer.compare(await file.body(), pdf)).toBe(0);

  // Without a session: neither the list, nor the file, nor an upload.
  const anonymous = await playwright.request.newContext({ baseURL, storageState: undefined });
  expect((await anonymous.get(`/api/recurring-expenses/${rule.id}/attachments`)).status()).toBe(
    401,
  );
  expect((await anonymous.get((await link.getAttribute("href"))!)).status()).toBe(401);
  expect(
    (
      await anonymous.post(`/api/recurring-expenses/${rule.id}/attachments`, {
        multipart: { file: { name: "x.pdf", mimeType: "application/pdf", buffer: pdf } },
      })
    ).status(),
  ).toBe(401);
  await anonymous.dispose();

  // This year's invoice, on this year's payment.
  const payments = dialog.getByRole("region", { name: "Payments" });
  await expect(payments.getByRole("listitem")).toHaveCount(2);
  await expect(payments).toContainText("no receipt");
  const chooser = page.waitForEvent("filechooser");
  await payments
    .getByRole("button", { name: /^Add a receipt to the payment of 1 Jan 2026/ })
    .click();
  await (
    await chooser
  ).setFiles({ name: "Rechnung-2026.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(payments.getByRole("listitem").first()).toContainText("1 receipt");
  await expect(payments.getByRole("listitem").last()).toContainText("no receipt");

  // The list marks the rule as holding a document.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("row", { name: /Building insurance/ })).toContainText("1 document");
});
