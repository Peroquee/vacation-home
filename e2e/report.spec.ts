import { expect, test } from "@playwright/test";

// The dashboard's exports on the built server (GitLab #83, #90): the PDF
// renders in the production bundle, and the CSV carries its header.

test("the dashboard exports its period as a PDF report", async ({ request }) => {
  const response = await request.get("/api/reports/financial?from=2026-07-01&until=2026-07-31");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/pdf");
  const body = await response.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
});

test("the ledger exports as CSV with the documented columns", async ({ request }) => {
  const response = await request.get("/api/transactions/export?from=2026-07-01&to=2026-08-01");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/csv/);
  expect((await response.text()).replace(/^﻿/, "").split("\r\n")[0]).toBe(
    "date,type,amount,currency,category,property,description,booking_id,id",
  );
});
