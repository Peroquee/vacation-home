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

test("the development-only UI gallery is not served in production", async ({ request }) => {
  const response = await request.get("/dev/ui");
  expect(response.status()).toBe(404);
});

test("every response carries a request id, keeping a well-formed upstream one", async ({
  request,
}) => {
  const generated = await request.get("/calendar");
  expect(generated.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

  const forwarded = await request.get("/calendar", {
    headers: { "x-request-id": "upstream-12345678" },
  });
  expect(forwarded.headers()["x-request-id"]).toBe("upstream-12345678");

  const injected = await request.get("/calendar", {
    headers: { "x-request-id": 'bad", "level": "fatal' },
  });
  expect(injected.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
});

test("the error test route is off unless explicitly enabled", async ({ request }) => {
  const response = await request.get("/api/debug/error");
  expect(response.status()).toBe(404);
});
