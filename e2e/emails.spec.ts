import { type APIRequestContext, expect, test } from "@playwright/test";
import { solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";

import { withE2eDb } from "./database";

// Guest and owner emails (GitLab #111), read back from Mailpit: one email
// per step of a request that becomes a paid booking, each sent once, the
// exact address only in the last; the confirmations carry the stay for the
// guest's calendar (GitLab #125). Needs the CI job's Mailpit service
// (E2E_SMTP_HOST and E2E_MAILPIT_URL); skipped without it, except in CI.

const MAILPIT = process.env.E2E_MAILPIT_URL;
if (process.env.CI && !MAILPIT) throw new Error("E2E_MAILPIT_URL is not set");
test.skip(!MAILPIT, "needs Mailpit: set E2E_SMTP_HOST and E2E_MAILPIT_URL");

const GUEST = "mira@e2e.example.test";
const OWNER = "owner@e2e.example.test";

const today = new Date().toISOString().slice(0, 10);
function day(offset: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

type Summary = { ID: string; Subject: string; To: { Address: string }[] };
type Message = {
  ID: string;
  Subject: string;
  Text: string;
  HTML: string;
  Inline: unknown[];
  Attachments: { PartID: string; FileName: string; ContentType: string }[];
};

/** A message's stay.ics, unfolded (RFC 5545, 3.1). */
async function calendarOf(request: APIRequestContext, mail: Message): Promise<string> {
  const files = mail.Attachments.filter((a) => a.FileName === "stay.ics");
  expect(files).toHaveLength(1);
  expect(files[0]!.ContentType).toContain("text/calendar");
  const part = await request.get(`${MAILPIT}/api/v1/message/${mail.ID}/part/${files[0]!.PartID}`);
  return (await part.text()).replace(/\r\n /g, "");
}

const icsLine = (ics: string, name: string) =>
  ics.split("\r\n").find((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`));

/** The emails to `address`, oldest first. */
async function mailTo(request: APIRequestContext, address: string): Promise<Summary[]> {
  const response = await request.get(`${MAILPIT}/api/v1/messages?limit=200`);
  const { messages } = (await response.json()) as { messages: Summary[] };
  return messages.filter((m) => m.To.some((to) => to.Address === address)).reverse();
}

async function message(request: APIRequestContext, id: string): Promise<Message> {
  return (await (await request.get(`${MAILPIT}/api/v1/message/${id}`)).json()) as Message;
}

/** Runs the outbox now and waits for the guest and owner to have that many emails. */
async function expectMail(request: APIRequestContext, guest: number, owner: number) {
  expect((await request.post("/api/email/send-now")).status()).toBe(200);
  await expect
    .poll(async () => [
      (await mailTo(request, GUEST)).length,
      (await mailTo(request, OWNER)).length,
    ])
    .toEqual([guest, owner]);
}

test.beforeEach(async ({ request }) => {
  await request.delete(`${MAILPIT}/api/v1/messages`);
});

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("DELETE FROM transactions WHERE booking_id IS NOT NULL");
    await db.query("DELETE FROM booking_payments");
    await db.query("DELETE FROM bookings");
    await db.query("DELETE FROM guests");
    await db.query("DELETE FROM property_listings");
    await db.query("DELETE FROM properties");
  });
});

test("each step of a booking mails the guest once, the address only once paid", async ({
  request,
  browser,
  baseURL,
}) => {
  const property = (await (
    await request.post("/api/properties", {
      data: {
        name: "Mail Lake",
        timezone: "UTC",
        currency: "EUR",
        defaultNightlyRateMinor: 25_000,
        defaultCleaningFeeMinor: 10_000,
        slug: "mail-lake",
        publiclyListed: true,
      },
    })
  ).json()) as { id: string };
  expect(
    (
      await request.put(`/api/properties/${property.id}/listing`, {
        data: {
          titleEn: "Lake house",
          maxGuests: 4,
          exactAddress: "Uferweg 7, 37000 Seedorf",
          arrivalNotes: "Key box code 4711",
        },
      })
    ).status(),
  ).toBe(200);
  // Arrival from 15:00, departure between 10:00 and 11:00 (GitLab #126).
  expect(
    (
      await request.put(`/api/properties/${property.id}/stay-times`, {
        data: { checkInTime: "15:00", earliestCheckOutTime: "10:00", checkOutTime: "11:00" },
      })
    ).status(),
  ).toBe(200);
  await request.put(`/api/properties/${property.id}/bank-details`, {
    data: { accountHolder: "Ada Lovelace", iban: "DE89370400440532013000" },
  });

  // The guest's request: a confirmation to them, a notice to the owner.
  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const challenge = await (
    await stranger.request.get("/api/public/properties/mail-lake/request-challenge")
  ).json();
  const solution = (await solveChallenge({ challenge, deriveKey }))!;
  // A person takes a few seconds to fill the form; the server insists.
  await new Promise((resolve) => setTimeout(resolve, 3_500));
  const sent = await stranger.request.post("/api/public/properties/mail-lake/requests", {
    data: {
      checkIn: day(40),
      checkOut: day(44),
      guestCount: 2,
      name: "Mira",
      email: GUEST,
      consent: true,
      locale: "en-GB",
      homepage: "",
      altcha: {
        challenge: { parameters: challenge.parameters, signature: challenge.signature },
        solution: { counter: solution.counter, derivedKey: solution.derivedKey },
      },
    },
    headers: { origin: new URL(baseURL!).origin, "sec-fetch-site": "same-origin" },
  });
  expect(sent.status()).toBe(201);
  await stranger.close();
  await expectMail(request, 1, 1);
  const [ownerMail] = await mailTo(request, OWNER);
  expect(ownerMail!.Subject).toContain("Mira");
  expect((await message(request, ownerMail!.ID)).Text).toContain("/bookings/requests");

  // Accepted: the dates are reserved; what to pay, how, and the guest's page.
  const bookingId = await withE2eDb(
    async (db) => (await db.query<{ id: string }>("SELECT id FROM bookings")).rows[0]!.id,
  );
  const reserved = await request.post(`/api/bookings/${bookingId}/reserve`);
  expect(reserved.status()).toBe(200);
  const { depositAmountMinor, totalAmountMinor } = (await reserved.json()) as {
    depositAmountMinor: number;
    totalAmountMinor: number;
  };
  await expectMail(request, 2, 1);
  const reservedMail = await message(request, (await mailTo(request, GUEST))[1]!.ID);
  expect(reservedMail.Subject).toBe("Your dates at Lake house are reserved");
  expect(reservedMail.Text).toContain("IBAN: DE89 3704 0044 0532 0130 00");
  expect(reservedMail.Text).toMatch(/\/stay\/booking\/[A-Za-z0-9_-]{22}/);
  expect(reservedMail.HTML).toContain('src="cid:girocode"');
  expect(reservedMail.Inline).toHaveLength(1);

  // The deposit, then the balance.
  const pay = (kind: string, amountMinor: number) =>
    request.post(`/api/bookings/${bookingId}/payments`, {
      data: { kind, amountMinor, receivedOn: today },
    });
  expect((await pay("deposit", depositAmountMinor)).status()).toBe(201);
  await expectMail(request, 3, 1);
  expect((await pay("balance", totalAmountMinor - depositAmountMinor)).status()).toBe(201);
  await expectMail(request, 4, 1);

  const guestMail = await mailTo(request, GUEST);
  const bodies = await Promise.all(guestMail.map((m) => message(request, m.ID)));
  expect(bodies.map((m) => m.Subject)).toEqual([
    "Your request for Lake house",
    "Your dates at Lake house are reserved",
    "Your booking at Lake house is confirmed",
    "Everything is paid: see you at Lake house",
  ]);
  // The exact address and arrival notes: in the last email, and only there.
  for (const body of bodies.slice(0, 3)) expect(body.Text).not.toMatch(/Uferweg|4711/);
  expect(bodies[3]!.Text).toContain("Uferweg 7, 37000 Seedorf");
  expect(bodies[3]!.Text).toContain("Key box code 4711");

  // The confirmations carry the stay for the guest's calendar (GitLab #125):
  // the .ics and the quick links; the request and the reservation do not.
  for (const body of bodies.slice(0, 2)) {
    expect(body.Attachments.filter((a) => a.FileName === "stay.ics")).toHaveLength(0);
  }
  const [confirmedIcs, paidIcs] = [
    await calendarOf(request, bodies[2]!),
    await calendarOf(request, bodies[3]!),
  ];
  for (const [body, ics] of [
    [bodies[2]!, confirmedIcs],
    [bodies[3]!, paidIcs],
  ] as const) {
    expect(body.Text).toContain("https://calendar.google.com/calendar/render?action=TEMPLATE");
    expect(body.Text).toContain("https://outlook.live.com/calendar/0/action/compose?");
    // From the earliest arrival to the latest departure (the property is in UTC).
    expect(icsLine(ics, "DTSTART")).toBe(`DTSTART:${day(40).replaceAll("-", "")}T150000Z`);
    expect(icsLine(ics, "DTEND")).toBe(`DTEND:${day(44).replaceAll("-", "")}T110000Z`);
    expect(icsLine(ics, "SUMMARY")).toBe("SUMMARY:Stay: Lake house");
    expect(ics).toContain("Departure between 10:00 and 11:00");
  }
  // One entry, updated by the second file; the address only in the last.
  expect(icsLine(paidIcs, "UID")).toBe(icsLine(confirmedIcs, "UID"));
  expect(Number(icsLine(paidIcs, "SEQUENCE")!.slice(9))).toBeGreaterThan(
    Number(icsLine(confirmedIcs, "SEQUENCE")!.slice(9)),
  );
  expect(confirmedIcs).not.toMatch(/Uferweg/);
  expect(icsLine(paidIcs, "LOCATION")).toBe("LOCATION:Uferweg 7\\, 37000 Seedorf");

  // The same entry from the guest's page, opened by its link and nothing else.
  const link = bodies[3]!.Text.match(/https?:\/\/\S+\/stay\/booking\/[A-Za-z0-9_-]{22}/)![0];
  const stranger2 = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const download = await stranger2.request.get(`${new URL(link).pathname}/calendar.ics?lang=en-GB`);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toContain("text/calendar");
  expect(download.headers()["set-cookie"]).toBeUndefined();
  const downloaded = (await download.text()).replace(/\r\n /g, "");
  expect(icsLine(downloaded, "UID")).toBe(icsLine(paidIcs, "UID"));
  expect(downloaded).not.toMatch(/Uferweg/);
  const unknown = await stranger2.request.get("/stay/booking/AAAAAAAAAAAAAAAAAAAAAA/calendar.ics");
  expect(unknown.status()).toBe(404);
  await stranger2.close();

  // Running the outbox again sends nothing twice.
  await expectMail(request, 4, 1);
});
