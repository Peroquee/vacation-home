import { mkdir, readFile, writeFile } from "node:fs/promises";

import { chromium, expect, test } from "@playwright/test";

import { STORAGE_STATE, withE2eDb } from "./database";

// Lighthouse on the calendar and the dashboard (GitLab #97), signed in, on
// the built server with a realistic amount of data, under Lighthouse's
// default mobile throttling (a slow 4G connection, a 4x slower CPU). The
// reports land in lighthouse/ (a CI artifact). Run on its own:
//
//   npx playwright test --project=lighthouse
//
// Both pages must reach a performance score of at least 90.

const PAGES = { calendar: "/calendar", dashboard: "/dashboard" };
const PORT = 9223;

test.afterAll(async () => {
  await withE2eDb(async (db) => {
    await db.query("DELETE FROM transactions");
    await db.query("DELETE FROM bookings");
    await db.query("DELETE FROM blocks");
    await db.query("DELETE FROM guests");
    await db.query("DELETE FROM properties");
  });
});

test("calendar and dashboard score at least 90 under throttling", async ({ request, baseURL }) => {
  test.setTimeout(300_000);

  // About a year of a busy two-property business.
  const today = new Date().toISOString().slice(0, 10);
  const day = (offset: number) => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const [category] = await (await request.get("/api/categories?type=expense")).json();
  for (const name of ["Lake House", "Sea View"]) {
    const property = await (
      await request.post("/api/properties", {
        data: { name, timezone: "Europe/Berlin", currency: "EUR", defaultNightlyRateMinor: 12_000 },
      })
    ).json();
    for (let i = 0; i < 40; i++) {
      const guest = await (
        await request.post("/api/guests", { data: { name: `Guest ${i}` } })
      ).json();
      const start = -240 + i * 9;
      await request.post("/api/bookings", {
        data: {
          propertyId: property.id,
          guestId: guest.id,
          checkIn: day(start),
          checkOut: day(start + 4 + (i % 4)),
          status: i % 7 === 0 ? "inquiry" : "confirmed",
        },
      });
      await request.post("/api/transactions", {
        data: {
          propertyId: property.id,
          type: "expense",
          categoryId: category.id,
          amountMinor: 2_500 + i * 37,
          date: day(start),
          description: `Cleaning ${i}`,
        },
      });
    }
  }

  const state = JSON.parse(await readFile(STORAGE_STATE, "utf8"));
  const cookie = state.cookies
    .map((c: { name: string; value: string }) => `${c.name}=${c.value}`)
    .join("; ");
  const { default: lighthouse } = await import("lighthouse");
  const browser = await chromium.launch({ args: [`--remote-debugging-port=${PORT}`] });
  await mkdir("lighthouse", { recursive: true });
  const scores: Record<string, number> = {};
  try {
    for (const [name, path] of Object.entries(PAGES)) {
      const result = await lighthouse(`${baseURL}${path}`, {
        port: PORT,
        output: ["html", "json"],
        onlyCategories: ["performance"],
        extraHeaders: { Cookie: cookie },
        logLevel: "error",
      });
      if (!result) throw new Error(`no Lighthouse result for ${path}`);
      const [html, json] = result.report as string[];
      await writeFile(`lighthouse/${name}.html`, html!);
      await writeFile(`lighthouse/${name}.json`, json!);
      const { audits, categories } = result.lhr;
      scores[name] = Math.round((categories.performance?.score ?? 0) * 100);
      console.log(
        `${name}: ${scores[name]} (LCP ${audits["largest-contentful-paint"]?.displayValue}, ` +
          `TBT ${audits["total-blocking-time"]?.displayValue}, CLS ${audits["cumulative-layout-shift"]?.displayValue})`,
      );
    }
  } finally {
    await browser.close();
  }
  await writeFile("lighthouse/scores.json", JSON.stringify(scores, null, 2));
  for (const [name, score] of Object.entries(scores)) {
    expect.soft(score, `${name} performance score`).toBeGreaterThanOrEqual(90);
  }
});
