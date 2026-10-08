import { expect, test } from "@playwright/test";

import { withE2eDb } from "./database";

test.afterEach(async () => {
  await withE2eDb((db) => db.query("DELETE FROM guests"));
});

test("searching matches partial, case-insensitive input, taking % and _ literally", async ({
  request,
}) => {
  for (const guest of [
    { name: "Ada Lovelace", email: "ada@example.com" },
    { name: "Grace Hopper", email: "grace_h@navy.example" },
    { name: "100% Real Guest" },
  ]) {
    expect((await request.post("/api/guests", { data: guest })).status()).toBe(201);
  }
  const names = async (q: string) =>
    (await (await request.get("/api/guests", { params: { q } })).json()).map(
      (g: { name: string }) => g.name,
    );

  expect(await names("LOVEL")).toEqual(["Ada Lovelace"]);
  expect(await names("NAVY.EX")).toEqual(["Grace Hopper"]);
  // In SQL LIKE these are wildcards; a search must treat them as text.
  expect(await names("%")).toEqual(["100% Real Guest"]);
  expect(await names("_h@")).toEqual(["Grace Hopper"]);
});

test("simultaneous creates with one email produce one guest", async ({ request }) => {
  const responses = await Promise.all(
    ["Ada@Example.com", "ada@example.com", "ADA@EXAMPLE.COM"].map((email, i) =>
      request.post("/api/guests", { data: { name: `Ada ${i}`, email } }),
    ),
  );

  const statuses = responses.map((r) => r.status()).sort();
  expect(statuses).toEqual([200, 200, 201]);
  const ids = new Set(await Promise.all(responses.map(async (r) => (await r.json()).id)));
  expect(ids.size).toBe(1);
});
