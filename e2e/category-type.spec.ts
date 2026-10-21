import { expect, type Locator, test } from "@playwright/test";

import { withE2eDb } from "./database";

// GitLab #129, as reported: "Wenn man Type expense eingibt, kann man bei
// category immer noch income items wählen." After choosing expense, only
// expense categories can be chosen - in the transaction dialog and in the
// ledger's filter - and the API refuses the other type whatever is sent.

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("DELETE FROM transactions");
    await db.query("DELETE FROM properties");
  });
});

type Category = { id: string; name: string };

/** The option values a select offers, without its empty "choose" one. */
const offered = (scope: Locator, label: string) =>
  scope
    .getByLabel(label, { exact: true })
    .locator("option")
    .evaluateAll((options) =>
      options.map((o) => (o as HTMLOptionElement).value).filter((value) => value !== ""),
    );

for (const lang of [
  {
    locale: "en-GB",
    add: "Add a transaction",
    income: "Income",
    expense: "Expense",
    category: "Category",
    amount: "Amount",
    save: "Add",
    type: "Type",
  },
  {
    locale: "de-DE",
    add: "Posten erfassen",
    income: "Einnahme",
    expense: "Ausgabe",
    category: "Kategorie",
    amount: "Betrag",
    save: "Erfassen",
    type: "Art",
  },
] as const) {
  test.describe(lang.locale, () => {
    test.use({ locale: lang.locale });

    test("an expense offers and takes only expense categories", async ({ page, request }) => {
      const property = await (
        await request.post("/api/properties", {
          data: { name: "Lake House", timezone: "UTC", currency: "EUR" },
        })
      ).json();
      const income: Category[] = await (await request.get("/api/categories?type=income")).json();
      const expense: Category[] = await (await request.get("/api/categories?type=expense")).json();
      const ids = (list: Category[]) => list.map((c) => c.id).sort();

      await page.goto("/finance");
      await page.getByRole("button", { name: lang.add }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("radio", { name: lang.income }).click();
      await dialog.getByLabel(lang.category).selectOption(income[0]!.id);

      // The report: switched to expense, income categories were still there.
      await dialog.getByRole("radio", { name: lang.expense }).click();
      expect((await offered(dialog, lang.category)).sort()).toEqual(ids(expense));
      await expect(dialog.getByLabel(lang.category)).toHaveValue("");

      await dialog.getByLabel(lang.amount).fill("12");
      await dialog.getByLabel(lang.category).selectOption(expense[0]!.id);
      await dialog.getByRole("button", { name: lang.save, exact: true }).click();
      await expect(dialog).toBeHidden();
      const saved = await withE2eDb(
        async (db) =>
          (
            await db.query<{ type: string; category_id: string }>(
              "SELECT type, category_id FROM transactions WHERE property_id = $1",
              [property.id],
            )
          ).rows,
      );
      expect(saved).toEqual([{ type: "expense", category_id: expense[0]!.id }]);

      // The ledger's filter: the type limits the categories too.
      const filters = page.locator("form", { has: page.getByLabel(lang.type, { exact: true }) });
      await filters.getByLabel(lang.type, { exact: true }).selectOption("expense");
      expect((await offered(filters, lang.category)).sort()).toEqual(ids(expense));
    });
  });
}

test("the API refuses a category of the other type, on categoryId", async ({ request }) => {
  const property = await (
    await request.post("/api/properties", {
      data: { name: "Lake House", timezone: "UTC", currency: "EUR" },
    })
  ).json();
  const [income] = await (await request.get("/api/categories?type=income")).json();
  const response = await request.post("/api/transactions", {
    data: {
      propertyId: property.id,
      type: "expense",
      categoryId: income.id,
      amountMinor: 1_000,
      date: "2026-07-14",
    },
  });
  expect(response.status()).toBe(422);
  expect((await response.json()).error.fields).toEqual({
    categoryId: ["is not an expense category"],
  });
});
