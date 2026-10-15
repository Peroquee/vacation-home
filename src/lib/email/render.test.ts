import { describe, expect, it } from "vitest";

import { type EmailContext, renderEmail } from "./render";

const base: EmailContext = {
  kind: "reserved",
  recipient: "guest",
  locale: "en-GB",
  appUrl: "http://vacation.test",
  booking: {
    id: "booking-1",
    reference: "K7M2Q9XA",
    checkIn: "2026-08-03",
    checkOut: "2026-08-07",
    guestCount: 2,
    totalAmountMinor: 110_000,
    currency: "EUR",
    received: 0,
    next: { kind: "deposit", amountMinor: 33_000, dueOn: "2026-07-08" },
    declineReason: null,
    guestMessage: null,
  },
  guestName: "Ada",
  property: {
    title: { en: "Lake house", de: "Haus am See" },
    checkInTime: "15:00",
    checkOutTime: "10:00",
    houseRules: { en: "No parties.", de: "Keine Partys." },
    exactAddress: "Uferweg 7, 37000 Seedorf",
    arrivalNotes: "Key box code 4711",
  },
  bank: {
    accountHolder: "Erika Mustermann",
    iban: "DE89370400440532013000",
    bic: "COBADEFFXXX",
    bankName: null,
  },
  guestLink: "http://vacation.test/stay/booking/token",
};

const render = (patch: Partial<EmailContext>) => renderEmail({ ...base, ...patch });

describe("the emails", () => {
  it("ask for the payment with the bank details and an inline GiroCode", async () => {
    const email = await render({});
    expect(email.subject).toBe("Your dates at Lake house are reserved");
    expect(email.text).toContain("Hello Ada,");
    expect(email.text).toContain("Please pay the deposit of €330.00 by 8 July 2026.");
    expect(email.text).toContain("IBAN: DE89 3704 0044 0532 0130 00");
    expect(email.text).toContain("Booking K7M2-Q9XA");
    expect(email.text).toContain("http://vacation.test/stay/booking/token");
    expect(email.attachments).toEqual([
      expect.objectContaining({ cid: "girocode", contentType: "image/png" }),
    ]);
    expect(email.html).toContain('src="cid:girocode"');
    // No remote images, no tracking: the only image travels with the mail.
    expect(email.html).not.toMatch(/<img[^>]+src="https?:/);
  });

  it("say the details will follow when there are no bank details", async () => {
    const email = await render({ bank: null });
    expect(email.text).toContain("We will send you the bank details separately.");
    expect(email.text).not.toContain("IBAN");
    expect(email.attachments).toEqual([]);
  });

  it("give the exact address and arrival notes only once everything is paid", async () => {
    for (const kind of ["requested", "reserved", "deposit_received", "balance_reminder"] as const) {
      const email = await render({ kind });
      expect(email.text).not.toMatch(/Uferweg|4711/);
      expect(email.html).not.toMatch(/Uferweg|4711/);
    }
    const paid = await render({
      kind: "fully_paid",
      locale: "de-DE",
      booking: { ...base.booking, received: 110_000, next: null },
    });
    expect(paid.subject).toBe("Alles bezahlt: bis bald in Haus am See");
    expect(paid.text).toContain("Uferweg 7, 37000 Seedorf");
    expect(paid.text).toContain("Key box code 4711");
    expect(paid.text).toContain("Keine Partys.");
    expect(paid.text).toContain("Anreise ab 15:00 · Abreise bis 10:00");
  });

  it("write to the owner in the default language, escaping what the guest wrote", async () => {
    const email = await render({
      kind: "requested",
      recipient: "owner",
      locale: "en-GB",
      guestName: "Eve <b>",
      booking: { ...base.booking, guestMessage: '<script>alert("x")</script>' },
      guestLink: null,
    });
    expect(email.subject).toContain("Eve <b>");
    expect(email.text).toContain("http://vacation.test/bookings/requests");
    expect(email.text).not.toContain("Hello");
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<b>");
    expect(email.html).toContain("&#60;script&#62;");
  });

  it("link the legal pages on every email", async () => {
    for (const patch of [{}, { kind: "declined" as const }, { recipient: "owner" as const }]) {
      const email = await render({ kind: "requested", ...patch });
      expect(email.text).toContain("http://vacation.test/stay/legal/imprint");
      expect(email.text).toContain("http://vacation.test/stay/legal/privacy");
    }
  });
});
