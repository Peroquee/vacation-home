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
    cancelledBy: null,
    refundDueMinor: null,
    policy: { depositNonRefundable: true, depositAmountMinor: 33_000 },
  },
  guestName: "Ada",
  property: {
    title: { en: "Lake house", de: "Haus am See" },
    times: { checkInTime: "15:00", earliestCheckOutTime: "08:00", checkOutTime: "10:00" },
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
    expect(paid.text).toContain("Anreise ab 15:00 · Abreise zwischen 08:00 und 10:00");
  });

  it("carry the stay for the guest's calendar in the confirmations only (GitLab #125)", async () => {
    const calendar = {
      file: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
      google: "https://calendar.google.com/calendar/render?action=TEMPLATE&text=x",
      outlook: "https://outlook.live.com/calendar/0/action/compose?subject=x",
    };
    for (const kind of ["deposit_received", "fully_paid"] as const) {
      const email = await render({ kind, calendar });
      const ics = email.attachments.filter((a) => a.filename === "stay.ics");
      expect(ics).toHaveLength(1);
      expect(ics[0]).toMatchObject({ contentType: expect.stringContaining("text/calendar") });
      expect(ics[0]!.cid).toBeUndefined();
      expect(ics[0]!.content.toString()).toBe(calendar.file);
      expect(email.text).toContain(`Add to Google Calendar: ${calendar.google}`);
      expect(email.text).toContain(`Add to Outlook.com: ${calendar.outlook}`);
      expect(email.html).toContain(`href="${calendar.google.replace("&", "&#38;")}"`);
    }
    const german = await render({ kind: "fully_paid", locale: "de-DE", calendar });
    expect(german.text).toContain("In den Kalender eintragen:");
    for (const kind of ["reserved", "balance_reminder"] as const) {
      const email = await render({ kind, calendar });
      expect(email.attachments.map((a) => a.filename)).not.toContain("stay.ics");
      expect(email.text).not.toContain("calendar.google.com");
    }
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

  it("repeat the cancellation policy with what asks for payment", async () => {
    expect((await render({})).text).toContain(
      "The deposit of €330.00 is non-refundable if you cancel. Anything paid beyond the deposit is refunded in full.",
    );
    const german = await render({ kind: "deposit_received", locale: "de-DE" });
    expect(german.text).toMatch(
      /Die Anzahlung von 330,00\s€ wird bei einer Stornierung nicht erstattet\./,
    );
    const refundable = await render({
      booking: {
        ...base.booking,
        policy: { depositNonRefundable: false, depositAmountMinor: 33_000 },
      },
    });
    expect(refundable.text).toContain(
      "If you cancel, everything you have paid is refunded in full.",
    );
    expect((await render({ kind: "requested" })).text).not.toContain("If you cancel");
  });

  it("name the regular deposit as kept, even when the full amount is due at short notice", async () => {
    const email = await render({
      booking: {
        ...base.booking,
        next: { kind: "full", amountMinor: 110_000, dueOn: "2026-07-04" },
        policy: { depositNonRefundable: true, depositAmountMinor: 22_000 },
      },
    });
    expect(email.text).toContain("Please pay the full amount of €1,100.00");
    expect(email.text).toContain("The deposit of €220.00 is non-refundable if you cancel.");
  });

  it("tell of a cancellation and its refund, and the owner of the guest's", async () => {
    const cancelled = { ...base.booking, cancelledBy: "guest" as const, received: 33_000 };
    const toGuest = await render({
      kind: "cancelled",
      booking: { ...cancelled, refundDueMinor: 0 },
    });
    expect(toGuest.subject).toBe("Your booking at Lake house is cancelled");
    expect(toGuest.text).toContain("As you asked, we have cancelled your booking.");
    expect(toGuest.text).toContain("Under the cancellation policy, no refund is due.");
    const byOwner = await render({
      kind: "cancelled",
      booking: { ...cancelled, cancelledBy: "owner", refundDueMinor: 33_000 },
    });
    expect(byOwner.text).toContain("we have had to cancel your booking");
    expect(byOwner.text).toContain("We will refund €330.00 to you.");
    const toOwner = await render({
      kind: "cancelled",
      recipient: "owner",
      booking: { ...cancelled, refundDueMinor: 16_500 },
    });
    expect(toOwner.subject).toMatch(/^Gast hat storniert: Ada/);
    expect(toOwner.text).toContain("Zu erstatten sind 165,00");
  });

  it("link the legal pages on every email", async () => {
    for (const patch of [{}, { kind: "declined" as const }, { recipient: "owner" as const }]) {
      const email = await render({ kind: "requested", ...patch });
      expect(email.text).toContain("http://vacation.test/stay/legal/imprint");
      expect(email.text).toContain("http://vacation.test/stay/legal/privacy");
    }
  });
});

describe("the Kurtaxe in an email (GitLab #120)", () => {
  it("is named with the total it is part of", async () => {
    const email = await renderEmail({
      ...base,
      booking: { ...base.booking, touristTaxMinor: 3_750 },
    });
    expect(email.text).toMatch(/1,100\.00 \(including €37\.50 Kurtaxe\)/);
  });
});
