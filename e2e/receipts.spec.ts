import { expect, test } from "@playwright/test";

import { withE2eDb } from "./database";

// Receipts on the built server (GitLab #82): a real multipart upload, the
// file served back to a signed-in user only, and removal.

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("DELETE FROM transactions");
    await db.query("DELETE FROM properties");
  });
});

test("a receipt is uploaded, served back only when signed in, and removed", async ({
  request,
  playwright,
  baseURL,
}) => {
  const property = await (
    await request.post("/api/properties", {
      data: { name: "Lake House", timezone: "Europe/Lisbon", currency: "EUR" },
    })
  ).json();
  const [category] = await (await request.get("/api/categories?type=expense")).json();
  const transaction = await (
    await request.post("/api/transactions", {
      data: {
        propertyId: property.id,
        type: "expense",
        categoryId: category.id,
        amountMinor: 4_500,
        date: "2026-07-14",
      },
    })
  ).json();

  const pdf = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
  const uploaded = await request.post(`/api/transactions/${transaction.id}/attachments`, {
    multipart: { file: { name: "Rechnung.pdf", mimeType: "application/pdf", buffer: pdf } },
  });
  expect(uploaded.status()).toBe(201);
  const receipt = await uploaded.json();

  const file = await request.get(`/api/attachments/${receipt.id}`);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toBe("application/pdf");
  expect(file.headers()["content-disposition"]).toMatch(/^attachment;/);
  expect(Buffer.compare(await file.body(), pdf)).toBe(0);

  // Without a session: no file, whatever the id.
  const anonymous = await playwright.request.newContext({ baseURL, storageState: undefined });
  expect((await anonymous.get(`/api/attachments/${receipt.id}`)).status()).toBe(401);
  await anonymous.dispose();

  expect((await request.delete(`/api/attachments/${receipt.id}`)).status()).toBe(204);
  expect((await request.get(`/api/attachments/${receipt.id}`)).status()).toBe(404);
});
