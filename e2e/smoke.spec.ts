import { expect, test } from "@playwright/test";

import { withE2eDb } from "./database";

test("the home page redirects to the calendar", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
});

test("the API reads what is in the database", async ({ request }) => {
  await withE2eDb((db) =>
    db.query("INSERT INTO properties (name, updated_at) VALUES ($1, now())", ["Seaside Cottage"]),
  );

  const response = await request.get("/api/properties");
  expect(response.ok()).toBe(true);

  // Exactly one row: this only holds on every run because the database is
  // reset before each one.
  const properties: { name: string }[] = await response.json();
  expect(properties.map((p) => p.name)).toEqual(["Seaside Cottage"]);
});
