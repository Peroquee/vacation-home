import { expect, test } from "@playwright/test";
import { Client } from "pg";

import { E2E_DATABASE_URL } from "./database";

test("the home page redirects to the calendar", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
});

test("the API reads what is in the database", async ({ request }) => {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query("INSERT INTO properties (name, updated_at) VALUES ($1, now())", [
      "Seaside Cottage",
    ]);
  } finally {
    await client.end();
  }

  const response = await request.get("/api/properties");
  expect(response.ok()).toBe(true);

  // Exactly one row: this only holds on every run because the database is
  // reset before each one.
  const properties: { name: string }[] = await response.json();
  expect(properties.map((p) => p.name)).toEqual(["Seaside Cottage"]);
});
