import { expect, test } from "@playwright/test";

import { withE2eDb } from "./database";

// GitLab #131: a new expense takes its receipt straight away, the ledger
// marks it with the paperclip, and "Without a receipt" finds the others.

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("DELETE FROM transactions");
    await db.query("DELETE FROM properties");
  });
});

const pdf = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");

test("an expense saved with a PDF shows the paperclip, and the filter finds the one without", async ({
  page,
  request,
}) => {
  const property = await (
    await request.post("/api/properties", {
      data: { name: "Lake House", timezone: "UTC", currency: "EUR" },
    })
  ).json();
  const [category] = await (await request.get("/api/categories?type=expense")).json();
  // The ledger opens on this month, and the dialog on today.
  const today = new Date().toISOString().slice(0, 10);
  await request.post("/api/transactions", {
    data: {
      propertyId: property.id,
      type: "expense",
      categoryId: category.id,
      amountMinor: 2_000,
      date: today,
      description: "Paid in cash",
    },
  });

  await page.goto("/finance");
  // With rows in the ledger, its button is "Add" with its shortcut, T.
  await page
    .getByRole("button", { name: /^Add\b/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount").fill("45");
  await dialog.getByLabel("Category").selectOption(category.id);
  await dialog.getByLabel("Description").fill("Plumber");
  await dialog
    .getByLabel("Add receipts", { exact: true })
    .setInputFiles({ name: "Rechnung.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(dialog.getByText("Rechnung.pdf")).toBeVisible();
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();

  const table = page.getByRole("table");
  await expect(table.getByRole("button", { name: /^Edit: Plumber/ })).toContainText("1 receipt");
  await expect(table.getByRole("button", { name: /^Edit: Paid in cash/ })).not.toContainText(
    "receipt",
  );
  const stored = await withE2eDb(
    async (db) =>
      (
        await db.query<{ file_name: string; media_type: string }>(
          `SELECT a.file_name, a.media_type FROM transaction_attachments a
           JOIN transactions t ON t.id = a.transaction_id WHERE t.description = 'Plumber'`,
        )
      ).rows,
  );
  expect(stored).toEqual([{ file_name: "Rechnung.pdf", media_type: "application/pdf" }]);

  // "Without a receipt": only the cash payment is left.
  const filters = page.locator("form", { has: page.getByLabel("Type", { exact: true }) });
  await filters.getByLabel("Receipts", { exact: true }).selectOption("none");
  await filters.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/receipts=none/);
  await expect(table.getByRole("button", { name: /^Edit: Paid in cash/ })).toBeVisible();
  await expect(table.getByRole("button", { name: /^Edit: Plumber/ })).toHaveCount(0);

  // And with one: only the plumber.
  await filters.getByLabel("Receipts", { exact: true }).selectOption("some");
  await filters.getByRole("button", { name: "Apply" }).click();
  await expect(table.getByRole("button", { name: /^Edit: Plumber/ })).toBeVisible();
  await expect(table.getByRole("button", { name: /^Edit: Paid in cash/ })).toHaveCount(0);
});
