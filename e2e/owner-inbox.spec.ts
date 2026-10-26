import { type APIRequestContext, expect, test } from "@playwright/test";

import { withE2eDb } from "./database";
import { day } from "./dates";

// The owner's inbox (GitLab #110): requests from the public site with a
// badge in the navigation, accepted (reserved) or declined there; one whose
// dates were taken meanwhile is refused with the conflict shown.
//
// The requests are put straight into the database: sending them through the
// public form is the request form's own spec (booking-requests.spec.ts), and
// the public request rate limit is shared by every spec.

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    // Booking income is on (GitLab #137): bookings have ledger entries.
    await db.query("DELETE FROM transactions WHERE booking_id IS NOT NULL");
    await db.query("DELETE FROM bookings");
    await db.query("DELETE FROM guests");
    await db.query("DELETE FROM properties");
  });
});

async function property(request: APIRequestContext) {
  return (await (
    await request.post("/api/properties", {
      data: {
        name: "Inbox Lake",
        timezone: "UTC",
        currency: "EUR",
        defaultNightlyRateMinor: 10_000,
      },
    })
  ).json()) as { id: string };
}

/** A request as the public form stores it. */
async function websiteRequest(
  propertyId: string,
  {
    name,
    reference,
    checkIn,
    checkOut,
  }: { name: string; reference: string; checkIn: string; checkOut: string },
): Promise<string> {
  return withE2eDb(async (db) => {
    const guest = await db.query<{ id: string }>(
      "INSERT INTO guests (name, email, updated_at) VALUES ($1, $2, now()) RETURNING id",
      [name, `${reference.toLowerCase()}@example.test`],
    );
    const booking = await db.query<{ id: string }>(
      `INSERT INTO bookings (property_id, guest_id, check_in, check_out, status, source,
         guest_count, nightly_rate_minor, cleaning_fee_minor, total_amount_minor, currency,
         reference, guest_message, requester_name, guest_locale, privacy_consent_at, updated_at)
       VALUES ($1, $2, $3, $4, 'inquiry', 'website', 2, 10000, 0, $5, 'EUR',
         $6, 'We would love to come.', $7, 'en-GB', now(), now())
       RETURNING id`,
      [
        propertyId,
        guest.rows[0]!.id,
        checkIn,
        checkOut,
        10_000 * Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000),
        reference,
        name,
      ],
    );
    return booking.rows[0]!.id;
  });
}

test("the owner accepts one request and declines another from the inbox", async ({
  request,
  page,
}) => {
  const { id } = await property(request);
  await websiteRequest(id, {
    name: "Ada Lovelace",
    reference: "ADAAAAAA",
    checkIn: day(60),
    checkOut: day(64),
  });
  const rival = await websiteRequest(id, {
    name: "Bob Builder",
    reference: "BBBBBBBB",
    checkIn: day(62),
    checkOut: day(66),
  });

  await page.goto("/bookings");
  // The badge on Bookings, read out as waiting requests.
  await expect(
    page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: /Bookings 2 waiting/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Requests (2)" }).click();
  await expect(page.getByRole("heading", { name: "2 open requests" })).toBeVisible();

  const ada = page.getByRole("listitem").filter({ hasText: "Ada Lovelace" });
  await expect(ada).toContainText("We would love to come.");
  await expect(ada).toContainText("ref. ADAA-AAAA");
  await expect(ada).toContainText("estimate €400.00");
  await ada.getByRole("button", { name: "Accept and reserve" }).click();
  await expect(page.getByRole("heading", { name: "1 open request" })).toBeVisible();
  const awaiting = page.getByRole("region", { name: "Awaiting payment (1)" });
  await expect(awaiting).toContainText("Ada Lovelace");
  await expect(awaiting).toContainText("Deposit €80.00");

  // Bob's dates are Ada's now.
  const bob = page.getByRole("listitem").filter({ hasText: "Bob Builder" });
  await bob.getByRole("button", { name: "Accept and reserve" }).click();
  await expect(bob.getByRole("alert")).toContainText(
    "This request cannot be accepted: its dates are taken.",
  );
  await expect(bob.getByRole("alert").getByRole("link")).toContainText("Ada Lovelace");

  await bob.getByRole("button", { name: "Decline" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason for the guest (optional)").fill("Those dates are taken.");
  await dialog.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByText("No requests waiting")).toBeVisible();

  const declined = await (await request.get(`/api/bookings/${rival}`)).json();
  expect(declined).toMatchObject({
    status: "cancelled",
    declineReason: "Those dates are taken.",
    declinedAt: expect.any(String),
  });
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Bookings" }),
  ).toBeVisible();
});

test("how long requests wait and are kept is set per property", async ({ request, page }) => {
  const { id } = await property(request);
  expect(await (await request.get(`/api/properties/${id}/request-settings`)).json()).toEqual({
    expiryDays: 3,
    retentionMonths: 6,
  });

  await page.goto("/settings");
  await page.getByRole("button", { name: "Edit the request settings of Inbox Lake" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Answer within (days)").fill("5");
  await dialog.getByLabel("Keep declined and expired requests (months)").fill("40");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(
    dialog.getByText(
      "Keep declined and expired requests (months) must be a whole number from 1 to 36",
    ),
  ).toBeVisible();
  await dialog.getByLabel("Keep declined and expired requests (months)").fill("12");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#request-settings")).toContainText(
    "answer within 5 days · kept 12 months",
  );
});
