import { type APIRequestContext, expect, test } from "@playwright/test";
import { solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";

import { withE2eDb } from "./database";

// Booking requests from the public site (GitLab #109): a guest picks a stay
// and sends a request; it reaches the owner as an inquiry from the website.
// Refused: dates not available, too many guests, no consent, the honeypot -
// whose spam check is then spent for good.
//
// Without TRUST_PROXY_HEADERS every visitor shares the request rate limit
// (10 per 10 minutes), so this file sends fewer than that.

const today = new Date().toISOString().slice(0, 10);
function day(offset: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("DELETE FROM bookings");
    await db.query("DELETE FROM guests");
    await db.query("DELETE FROM property_listings");
    await db.query("DELETE FROM properties");
  });
});

/** A listed property (UTC, so "today" here is today there) that sleeps 4. */
async function listedProperty(request: APIRequestContext) {
  const property = (await (
    await request.post("/api/properties", {
      data: {
        name: "Requests Lake",
        timezone: "UTC",
        currency: "EUR",
        defaultNightlyRateMinor: 10_000,
        defaultCleaningFeeMinor: 5_000,
        slug: "requests-lake",
        publiclyListed: true,
      },
    })
  ).json()) as { id: string };
  const saved = await request.put(`/api/properties/${property.id}/listing`, {
    data: { maxGuests: 4 },
  });
  expect(saved.status()).toBe(200);
  return property;
}

test("a guest requests a stay and the owner finds it as an inquiry from the website", async ({
  request,
  browser,
  page: owner,
}) => {
  await listedProperty(request);

  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await stranger.newPage();
  await page.goto("/stay/requests-lake");
  const dayButton = (offset: number) => page.locator(`button[data-date="${day(offset)}"]`).first();
  await dayButton(10).click();
  await dayButton(13).click();
  await page.getByRole("button", { name: "Request these dates" }).click();

  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill("Ada@Example.test");
  await page.getByLabel("Guests").fill("5");
  await page.getByLabel("Message to the owner").fill("Arriving late, around 9 pm.");
  await expect(page.getByRole("link", { name: "privacy policy" })).toHaveAttribute(
    "href",
    "/stay/legal/privacy",
  );
  await page.getByRole("checkbox", { name: /I agree/ }).check();
  await page.getByRole("button", { name: "Send request" }).click();
  // Checked again by the server, and refused by field.
  await expect(page.getByText("Guests this home sleeps at most 4 guests")).toBeVisible();

  await page.getByLabel("Guests").fill("3");
  await page.getByRole("button", { name: "Send request" }).click();

  const sent = page.getByTestId("request-sent");
  await expect(sent.getByRole("heading")).toHaveText("Thank you, your request has been sent");
  // 3 x 100.00 + 50.00 cleaning.
  await expect(sent).toContainText("€350.00");
  const reference = (await sent.locator("dd").first().textContent())!;
  expect(reference).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  await stranger.close();

  const { items } = await (await request.get("/api/bookings?source=website")).json();
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    status: "inquiry",
    source: "website",
    checkIn: day(10),
    checkOut: day(13),
    guestCount: 3,
    reference: reference.replace("-", ""),
    guestMessage: "Arriving late, around 9 pm.",
    guest: { name: "Ada Lovelace" },
  });

  await owner.goto("/bookings");
  const row = owner.getByRole("row", { name: /Ada Lovelace/ });
  await expect(row).toContainText("Inquiry");
  await expect(row).toContainText("Website");
});

test.describe("the request API refuses", () => {
  test("taken dates, too many guests, no consent, the honeypot and a spent spam check", async ({
    request,
    browser,
    baseURL,
  }) => {
    const property = await listedProperty(request);
    const guest = await (await request.post("/api/guests", { data: { name: "Bob" } })).json();
    expect(
      (
        await request.post("/api/bookings", {
          data: {
            propertyId: property.id,
            guestId: guest.id,
            checkIn: day(20),
            checkOut: day(25),
            status: "confirmed",
          },
        })
      ).status(),
    ).toBe(201);

    const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const solved = async () => {
      const challenge = await (
        await stranger.request.get("/api/public/properties/requests-lake/request-challenge")
      ).json();
      const solution = (await solveChallenge({ challenge, deriveKey }))!;
      return {
        challenge: { parameters: challenge.parameters, signature: challenge.signature },
        solution: { counter: solution.counter, derivedKey: solution.derivedKey },
      };
    };
    // One for a guest, one for a bot.
    const [altcha, botAltcha] = [await solved(), await solved()];
    // A person takes a few seconds to fill the form; the server insists.
    await new Promise((resolve) => setTimeout(resolve, 3_500));

    const valid = {
      checkIn: day(10),
      checkOut: day(13),
      guestCount: 2,
      name: "Eve",
      email: "eve@example.test",
      consent: true,
      locale: "en-GB",
      homepage: "",
      altcha,
    };
    const origin = new URL(baseURL!).origin;
    const send = async (data: Record<string, unknown>) => {
      const response = await stranger.request.post(
        "/api/public/properties/requests-lake/requests",
        {
          data,
          headers: { origin, "sec-fetch-site": "same-origin" },
        },
      );
      return { status: response.status(), body: await response.json() };
    };

    const refusals: [Record<string, unknown>, Record<string, string[]>][] = [
      [{ checkIn: day(22), checkOut: day(24) }, { checkIn: ["these dates are not available"] }],
      [{ guestCount: 5 }, { guestCount: ["this home sleeps at most 4 guests"] }],
      [{ consent: false }, { consent: ["must be accepted to send the request"] }],
    ];
    for (const [change, fields] of refusals) {
      const { status, body } = await send({ ...valid, ...change });
      expect({ change, status, fields: body.error?.fields }).toEqual({
        change,
        status: 422,
        fields,
      });
      // Nothing about what is in the way.
      expect(JSON.stringify(body)).not.toMatch(/Bob|booking/i);
    }
    expect(await withE2eDb(async (db) => (await db.query("SELECT 1 FROM bookings")).rowCount)).toBe(
      1,
    );

    // Refusals the guest can correct give the spam check back.
    expect((await send(valid)).status).toBe(201);

    // The honeypot spends it for good: the same check does not pass again.
    const bot = { ...valid, email: "bot@example.test", altcha: botAltcha };
    expect(await send({ ...bot, homepage: "https://spam.example" })).toEqual({
      status: 422,
      body: {
        error: expect.objectContaining({
          fields: { _: ["The request could not be sent. Please try again."] },
        }),
      },
    });
    expect(await send(bot)).toEqual({
      status: 422,
      body: {
        error: expect.objectContaining({
          fields: { altcha: ["the automatic spam check failed; please send the request again"] },
        }),
      },
    });
    await stranger.close();
  });
});

test("the legal pages are there, saying they are not yet available", async ({ browser }) => {
  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await stranger.newPage();
  await page.goto("/stay/legal/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy policy");
  await expect(page.getByText("This page is not available yet.")).toBeVisible();
  await page.getByRole("link", { name: "Imprint" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Imprint");
  await stranger.close();
});
