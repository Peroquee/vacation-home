import { expect, test } from "@playwright/test";

import { withE2eDb } from "./database";

test("a property goes through create, read, update, archive and delete", async ({ request }) => {
  const created = await request.post("/api/properties", {
    data: { name: "Mountain Cabin", timezone: "Europe/Zurich", currency: "chf" },
  });
  expect(created.status()).toBe(201);
  const property = await created.json();

  try {
    expect(property).toMatchObject({ currency: "CHF", color: "#0f766e", archived: false });

    const read = await request.get(`/api/properties/${property.id}`);
    expect(await read.json()).toEqual(property);

    const updated = await request.patch(`/api/properties/${property.id}`, {
      data: { defaultNightlyRateMinor: 18000 },
    });
    expect((await updated.json()).defaultNightlyRateMinor).toBe(18000);

    const archived = await request.post(`/api/properties/${property.id}/archive`);
    expect((await archived.json()).archived).toBe(true);
    const active = await (await request.get("/api/properties")).json();
    expect(active.map((p: { id: string }) => p.id)).not.toContain(property.id);

    expect((await request.delete(`/api/properties/${property.id}`)).status()).toBe(204);
    expect((await request.get(`/api/properties/${property.id}`)).status()).toBe(404);
  } finally {
    // Other specs share this database; never leave the row behind.
    await withE2eDb((db) => db.query("DELETE FROM properties WHERE id = $1", [property.id]));
  }
});

test("a property with dependent records cannot be deleted, only archived", async ({ request }) => {
  // Stands in for bookings until they exist: any relation declared with
  // ON DELETE RESTRICT must turn a delete into a 409 through the real driver.
  const property = await (
    await request.post("/api/properties", {
      data: { name: "Booked House", timezone: "UTC", currency: "EUR" },
    })
  ).json();

  try {
    await withE2eDb(async (db) => {
      await db.query(
        "CREATE TABLE e2e_restrict_probe (property_id uuid REFERENCES properties(id) ON DELETE RESTRICT)",
      );
      await db.query("INSERT INTO e2e_restrict_probe VALUES ($1)", [property.id]);
    });

    const response = await request.delete(`/api/properties/${property.id}`);
    expect(response.status()).toBe(409);
    expect((await response.json()).error.message).toMatch(/Archive it instead/);
    expect((await request.get(`/api/properties/${property.id}`)).status()).toBe(200);
  } finally {
    await withE2eDb(async (db) => {
      await db.query("DROP TABLE IF EXISTS e2e_restrict_probe");
      await db.query("DELETE FROM properties WHERE id = $1", [property.id]);
    });
  }
});

test("invalid input is a 422 with per-field messages", async ({ request }) => {
  const response = await request.post("/api/properties", {
    data: { name: "", timezone: "Nowhere/Land", currency: "EUR" },
  });
  expect(response.status()).toBe(422);
  const { error } = await response.json();
  expect(Object.keys(error.fields).sort()).toEqual(["name", "timezone"]);
});

test("the database itself refuses an invalid property", async () => {
  await expect(
    withE2eDb((db) =>
      db.query(
        `INSERT INTO properties (name, timezone, currency, color, default_nightly_rate_minor, updated_at)
         VALUES ('Bad', 'UTC', 'EUR', '#0f766e', -100, now())`,
      ),
    ),
  ).rejects.toThrow(/properties_default_nightly_rate_non_negative/);
});
