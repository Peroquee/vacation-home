/**
 * The UX review's data (GitLab #132), written through the app's own services
 * so every derived row (ledger entries, events, deadlines, guest links) is
 * what real use would produce: two listed properties with photos, prices,
 * seasons, a discount and tourist tax; bookings in every status, among them
 * public-site requests answered, paid, declined and lapsed; a month and a bit
 * of income and expenses, with receipts; recurring costs.
 *
 * Dates are relative to today, so the calendar and the dashboard always show
 * a lived-in month. Run by playwright.ux.config.ts against its own database
 * (vacation_home_ux_e2e) after a reset; refuses any other database. Writes
 * the ids and the guest link the screenshots need to e2e/.auth/ux-seed.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { addDays, type CalendarDate } from "../../src/lib/calendar-date";
import { CABIN_SCENES, LAKE_SCENES, receiptPhoto, scenePhoto } from "./images";

export const MANIFEST = "e2e/.auth/ux-seed.json";

function refusal(databaseUrl: string | undefined): string | null {
  if (process.env.NODE_ENV === "production") return "NODE_ENV is production";
  if (!databaseUrl) return "DATABASE_URL is not set";
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "[::1]", "postgres", "db"].includes(url.hostname)) {
    return `"${url.hostname}" is not a local database host`;
  }
  if ([...url.searchParams.keys()].some((k) => /^(host|hostaddr|dbname|database)$/.test(k))) {
    return "DATABASE_URL overrides the connection with a query parameter";
  }
  if (!url.pathname.endsWith("_ux_e2e")) return "the database is not the UX review's (*_ux_e2e)";
  return null;
}

/** Throws on a service's error result, so a broken seed stops loudly. */
function ok<T extends object>(result: T | string, what: string): Exclude<T, { error: unknown }> {
  if (typeof result === "string" || "error" in result) {
    throw new Error(`${what}: ${JSON.stringify(result)}`);
  }
  return result as Exclude<T, { error: unknown }>;
}

/** Today in Germany, where the owner lives. */
function today(): CalendarDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
}

/** Noon on a calendar day, as the `now` of a service call made "back then". */
const at = (date: CalendarDate) => new Date(`${date}T12:00:00Z`);

const LEGAL = {
  imprintName: "Katrin Albers",
  imprintAddress: "Lindenweg 7\n23714 Malente",
  imprintEmail: "urlaub@albers.example.test",
  imprintPhone: "+49 4523 000000",
  imprintVatId: "",
  imprintExtra: "",
  privacyPolicyDe:
    "## Datenschutz\n\nWir verarbeiten Ihre Angaben nur, um Ihre Anfrage und Ihren Aufenthalt abzuwickeln.",
  privacyPolicyEn:
    "## Privacy\n\nWe process your details only to handle your request and your stay.",
};

const LAKE_LISTING = {
  titleDe: "Haus am See – Reetdachhaus mit Steg",
  titleEn: "Lake House – thatched cottage with a jetty",
  descriptionDe:
    "Unser Reetdachhaus liegt direkt am Kellersee, mit eigenem Steg und Ruderboot. Morgens Kaffee auf der Terrasse, abends Sonnenuntergang über dem Wasser.\n\nDas Haus hat zwei Schlafzimmer, eine offene Küche mit Essplatz und einen Kaminofen für kühle Abende. Malente mit Bäcker und Supermarkt ist fünf Minuten mit dem Rad entfernt.",
  descriptionEn:
    "Our thatched cottage sits right on Lake Keller, with its own jetty and rowing boat. Coffee on the terrace in the morning, sunset over the water at night.\n\nTwo bedrooms, an open kitchen with a dining table and a wood stove for cool evenings. Malente, with a bakery and a supermarket, is five minutes away by bike.",
  houseRulesDe: "Bitte nicht rauchen im Haus. Hunde nach Absprache. Ruhe ab 22 Uhr.",
  houseRulesEn: "No smoking indoors. Dogs by arrangement. Quiet after 10 pm.",
  location: "Malente, Holsteinische Schweiz",
  maxGuests: 4,
  bedrooms: 2,
  bathrooms: 1,
  amenities: ["wifi", "kitchen", "dishwasher", "fireplace", "terrace", "garden", "parking", "bbq"],
  exactAddress: "Seeweg 3, 23714 Malente",
  arrivalNotes: "Der Schlüssel liegt im Schlüsselkasten neben der Tür, Code 4711.",
};

const CABIN_LISTING = {
  titleDe: "Berghütte am Waldrand",
  titleEn: "Mountain cabin at the edge of the forest",
  descriptionDe:
    "Eine Holzhütte auf 900 Metern, mit Blick auf die Allgäuer Alpen. Im Winter starten Loipe und Rodelhang vor der Tür, im Sommer die Wanderwege.\n\nSauna im Haus, Kachelofen in der Stube, zwei Schlafzimmer unterm Dach.",
  descriptionEn:
    "A wooden cabin at 900 metres, looking out over the Allgäu Alps. In winter the cross-country trail and the sledging hill start at the door, in summer the hiking paths.\n\nSauna inside, a tiled stove in the living room, two bedrooms under the roof.",
  houseRulesDe: "Bitte Schuhe im Flur ausziehen. Keine Haustiere.",
  houseRulesEn: "Please take your shoes off in the hall. No pets.",
  location: "Oberstaufen, Allgäu",
  maxGuests: 5,
  bedrooms: 2,
  bathrooms: 2,
  amenities: ["wifi", "kitchen", "sauna", "fireplace", "parking", "washingMachine", "babyCot"],
  exactAddress: "Am Hang 12, 87534 Oberstaufen",
  arrivalNotes: "Zufahrt im Winter nur mit Schneeketten.",
};

const ALT: Record<string, [string, string]> = {
  lake: ["Das Haus vom See aus gesehen", "The house seen from the lake"],
  cabin: ["Die Hütte vor den Bergen", "The cabin in front of the mountains"],
  terrace: ["Terrasse mit Blick auf den See", "Terrace looking out on the lake"],
  living: ["Wohnzimmer", "Living room"],
  bedroom: ["Schlafzimmer", "Bedroom"],
  kitchen: ["Küche", "Kitchen"],
};

const GUESTS = [
  ["Jonas Becker", "jonas.becker@example.test", "+49 151 2345 6789"],
  ["Miriam Schulte", "miriam.schulte@example.test", null],
  ["Familie Krüger", "krueger@example.test", "+49 170 555 0101"],
  ["Lena Hoffmann", "lena.hoffmann@example.test", null],
  ["Tobias Wagner", "t.wagner@example.test", "+49 160 777 1212"],
  ["Sophie Martin", "sophie.martin@example.test", null],
  ["Daniel Richter", "daniel.richter@example.test", null],
  ["Anna Vogel", "anna.vogel@example.test", "+43 664 123 4567"],
  ["Paul Neumann", "paul.neumann@example.test", null],
  ["Clara Weiß", "clara.weiss@example.test", null],
  ["Henrik Olsen", "henrik.olsen@example.test", "+45 20 12 34 56"],
  ["Marie Lambert", "marie.lambert@example.test", null],
] as const;

async function main() {
  const why = refusal(process.env.DATABASE_URL);
  if (why) {
    console.error(`Refusing to seed the UX review data: ${why}.`);
    process.exit(1);
  }

  // Loaded after the check, like prisma/seed.ts: @/env validates on load.
  const { db } = await import("../../src/lib/db");
  const { saveLegal } = await import("../../src/lib/legal/service");
  const { legalSchema } = await import("../../src/lib/legal/schema");
  const { createProperty } = await import("../../src/lib/properties/service");
  const { createPropertySchema } = await import("../../src/lib/properties/schema");
  const { saveListing, addPhoto, updatePhoto } = await import("../../src/lib/listing/service");
  const { listingSchema } = await import("../../src/lib/listing/schema");
  const { saveSeason, saveDiscounts, saveTouristTax } =
    await import("../../src/lib/pricing/service");
  const { seasonSchema, stayDiscountsSchema, touristTaxSchema } =
    await import("../../src/lib/pricing/schema");
  const { saveBookingRules } = await import("../../src/lib/booking-rules/service");
  const { bookingRulesSchema } = await import("../../src/lib/booking-rules/schema");
  const { paymentTermsSchema } = await import("../../src/lib/payment-terms/schema");
  const { savePaymentTerms } = await import("../../src/lib/payment-terms/service");
  const { saveBankDetails, bankDetailsSchema } = await import("../../src/lib/payments/bank");
  const { paymentSchema } = await import("../../src/lib/payments/schema");
  const { createGuestSchema } = await import("../../src/lib/guests/schema");
  const { findOrCreateGuest } = await import("../../src/lib/guests/service");
  const { createBooking, cancelBooking } = await import("../../src/lib/bookings/service");
  const { createBookingSchema } = await import("../../src/lib/bookings/schema");
  const { createBookingRequest } = await import("../../src/lib/booking-requests/service");
  const { declineRequest, expireRequests } = await import("../../src/lib/booking-requests/inbox");
  const { reserveBooking, runHold } = await import("../../src/lib/bookings/hold");
  const { recordPayment } = await import("../../src/lib/payments/service");
  const { issueGuestToken } = await import("../../src/lib/payments/guest-link");
  const { createTransaction, createTransactionSchema } =
    await import("../../src/lib/finance/transactions");
  const { createRecurringExpense, createRecurringExpenseSchema } =
    await import("../../src/lib/finance/recurring");
  const { addReceipt } = await import("../../src/lib/finance/receipts");
  const { systemCategory } = await import("../../src/lib/finance/categories");

  const T = today();

  ok(await saveLegal(legalSchema.parse(LEGAL)), "legal");

  // Properties, listed, with listing text, photos and prices.
  const lake = ok(
    await createProperty(
      createPropertySchema.parse({
        name: "Haus am See",
        address: "Seeweg 3, 23714 Malente",
        timezone: "Europe/Berlin",
        currency: "EUR",
        defaultNightlyRateMinor: 12_500,
        defaultCleaningFeeMinor: 7_000,
        color: "#0f766e",
        slug: "haus-am-see",
        publiclyListed: true,
      }),
    ),
    "lake property",
  );
  const cabin = ok(
    await createProperty(
      createPropertySchema.parse({
        name: "Berghütte",
        address: "Am Hang 12, 87534 Oberstaufen",
        timezone: "Europe/Berlin",
        currency: "EUR",
        defaultNightlyRateMinor: 16_000,
        defaultCleaningFeeMinor: 9_000,
        color: "#7c3aed",
        slug: "berghuette",
        publiclyListed: true,
      }),
    ),
    "cabin property",
  );

  for (const [property, listing, scenes] of [
    [lake, LAKE_LISTING, LAKE_SCENES],
    [cabin, CABIN_LISTING, CABIN_SCENES],
  ] as const) {
    await saveListing(property.id, listingSchema.parse(listing));
    // Booking income in the ledger, on as for any property created in the
    // app (GitLab #137); this seed writes the property directly.
    await db.incomeAutomation.create({ data: { propertyId: property.id, enabled: true } });
    for (const scene of scenes) {
      const { photo } = ok(await addPhoto(property.id, await scenePhoto(scene)), "photo");
      await updatePhoto(property.id, photo.id, { altDe: ALT[scene]![0], altEn: ALT[scene]![1] });
    }
    await saveBookingRules(
      property.id,
      bookingRulesSchema.parse({
        minNights: 2,
        maxNights: 28,
        minLeadDays: 1,
        horizonDays: 540,
        checkInWeekdays: [],
        bufferDays: 0,
      }),
    );
    await savePaymentTerms(
      property.id,
      paymentTermsSchema.parse({
        depositPercent: 30,
        depositFixedMinor: null,
        depositDueDays: 7,
        balanceDueDaysBefore: 30,
        fullPaymentDueDays: 3,
        depositNonRefundable: true,
      }),
    );
    ok(
      await saveBankDetails(
        property.id,
        bankDetailsSchema.parse({
          accountHolder: "Katrin Albers",
          iban: "DE89370400440532013000",
          bic: "COBADEFFXXX",
          bankName: "Commerzbank",
        }),
      ),
      "bank details",
    );
    await saveDiscounts(
      property.id,
      stayDiscountsSchema.parse({ tiers: [{ minNights: 7, percent: 10 }] }).tiers,
    );
  }

  ok(
    await saveSeason(
      lake.id,
      seasonSchema.parse({
        name: "Hauptsaison",
        startMonth: 6,
        startDay: 15,
        endMonth: 9,
        endDay: 15,
        year: null,
        rateMinor: 16_500,
      }),
    ),
    "lake summer",
  );
  ok(
    await saveSeason(
      cabin.id,
      seasonSchema.parse({
        name: "Wintersaison",
        startMonth: 12,
        startDay: 15,
        endMonth: 3,
        endDay: 15,
        year: null,
        rateMinor: 21_000,
      }),
    ),
    "cabin winter",
  );
  await saveTouristTax(
    cabin.id,
    touristTaxSchema.parse({
      rules: { adultRateMinor: 260, childGroups: [{ fromAge: 6, toAge: 15, rateMinor: 130 }] },
    }).rules,
  );

  const guests: Awaited<ReturnType<typeof findOrCreateGuest>>["guest"][] = [];
  for (const [name, email, phone] of GUESTS) {
    guests.push(
      (await findOrCreateGuest(createGuestSchema.parse({ name, email, phone: phone ?? undefined })))
        .guest,
    );
  }

  /** A booking entered by hand, in a status the form offers. */
  async function byHand(
    propertyId: string,
    guest: number,
    checkIn: CalendarDate,
    nights: number,
    status: "inquiry" | "confirmed" | "paid" | "cancelled",
    source: "direct" | "airbnb" | "booking.com" | "other",
    extra: { guestCount?: number; notes?: string } = {},
  ) {
    const input = createBookingSchema.parse({
      propertyId,
      guestId: guests[guest]!.id,
      checkIn,
      checkOut: addDays(checkIn, nights),
      status,
      source,
      guestCount: extra.guestCount ?? 2,
      notes: extra.notes,
    });
    return ok(await createBooking(input), `booking ${checkIn}`).booking;
  }

  /** A request as the public form sends it, received on `on`. */
  async function request(
    property: typeof lake,
    guest: number,
    checkIn: CalendarDate,
    nights: number,
    on: CalendarDate,
    message?: string,
  ) {
    const g = guests[guest]!;
    const result = await createBookingRequest(
      property,
      {
        checkIn,
        checkOut: addDays(checkIn, nights),
        guestCount: 2,
        name: g.name,
        email: g.email!,
        phone: g.phone ?? undefined,
        message,
        consent: true,
        locale: "de-DE",
        // Without the captcha the public route checks before calling this.
      } as Parameters<typeof createBookingRequest>[1],
      at(on),
    );
    const { request: sent } = ok(result, `request ${checkIn}`);
    // Received back then: the inbox's dates and the answer-by deadline read
    // from createdAt, which the database stamps with its own clock.
    return {
      booking: await db.booking.update({
        where: { reference: sent.reference },
        data: { createdAt: at(on) },
      }),
    };
  }

  // History: stays already over, paid; they fill the dashboard and the ledger.
  for (const [i, back] of [70, 55, 41, 30, 19, 9].entries()) {
    await byHand(lake.id, i, addDays(T, -back), 4 + (i % 3), "paid", i % 2 ? "airbnb" : "direct");
    await byHand(cabin.id, 11 - i, addDays(T, -back + 2), 3 + (i % 4), "paid", "booking.com");
  }
  // Staying now, and one cancelled earlier.
  const current = await byHand(lake.id, 6, addDays(T, -2), 5, "paid", "direct", {
    guestCount: 3,
    notes: "Reisen mit Hund",
  });
  await byHand(cabin.id, 7, addDays(T, 12), 4, "cancelled", "airbnb");

  // Upcoming, entered by hand: confirmed (Airbnb), paid, an inquiry by phone.
  await byHand(lake.id, 8, addDays(T, 9), 7, "confirmed", "airbnb");
  await byHand(cabin.id, 9, addDays(T, 20), 5, "paid", "booking.com", { guestCount: 4 });
  await byHand(lake.id, 10, addDays(T, 45), 3, "inquiry", "other", {
    notes: "Hat angerufen, meldet sich bis Freitag",
  });

  // The request flow, from the public site.
  // Fresh requests, waiting for an answer.
  await request(
    lake,
    0,
    addDays(T, 24),
    5,
    T,
    "Wir kommen mit zwei Kindern (4 und 7). Ist ein Kinderbett da?",
  );
  await request(cabin, 1, addDays(T, 60), 7, addDays(T, -1));
  // Accepted, waiting for the deposit.
  const reserved = await request(lake, 2, addDays(T, 33), 6, addDays(T, -2));
  ok(await reserveBooking(reserved.booking.id, at(addDays(T, -1))), "reserve");
  // Deposit in: confirmed. This one gets the guest link for the screenshots.
  const confirmed = await request(cabin, 3, addDays(T, 38), 5, addDays(T, -12));
  const confirmedBooking = ok(
    await reserveBooking(confirmed.booking.id, at(addDays(T, -11))),
    "reserve",
  ).booking;
  ok(
    await recordPayment(
      confirmed.booking.id,
      paymentSchema.parse({
        kind: "deposit",
        method: "bank_transfer",
        amountMinor: confirmedBooking.depositAmountMinor ?? 30_000,
        receivedOn: addDays(T, -6),
        note: null,
      }),
      at(addDays(T, -6)),
    ),
    "deposit",
  );
  // Paid in full straight away.
  const paid = await request(lake, 4, addDays(T, 70), 4, addDays(T, -20));
  const paidBooking = ok(
    await reserveBooking(paid.booking.id, at(addDays(T, -19))),
    "reserve",
  ).booking;
  ok(
    await recordPayment(
      paid.booking.id,
      paymentSchema.parse({
        kind: "full",
        method: "bank_transfer",
        amountMinor: paidBooking.totalAmountMinor,
        receivedOn: addDays(T, -15),
        note: null,
      }),
      at(addDays(T, -15)),
    ),
    "full payment",
  );
  // Declined, and one never answered in time.
  const declined = await request(cabin, 5, addDays(T, 26), 3, addDays(T, -8));
  ok(
    await declineRequest(
      declined.booking.id,
      "Zu dem Termin sind wir selbst dort.",
      at(addDays(T, -7)),
    ),
    "decline",
  );
  await request(lake, 7, addDays(T, 90), 4, addDays(T, -10));
  await expireRequests(at(T));
  // Accepted, but the deposit never came: lapses.
  const lapsed = await request(cabin, 9, addDays(T, 80), 3, addDays(T, -25));
  ok(await reserveBooking(lapsed.booking.id, at(addDays(T, -24))), "reserve");
  await runHold(at(T));
  // Cancelled by the guest after paying the deposit: a refund is due.
  const cancelled = await request(lake, 11, addDays(T, 110), 5, addDays(T, -30));
  const cancelledBooking = ok(
    await reserveBooking(cancelled.booking.id, at(addDays(T, -29))),
    "reserve",
  ).booking;
  ok(
    await recordPayment(
      cancelled.booking.id,
      paymentSchema.parse({
        kind: "full",
        method: "bank_transfer",
        amountMinor: cancelledBooking.totalAmountMinor,
        receivedOn: addDays(T, -26),
        note: null,
      }),
      at(addDays(T, -26)),
    ),
    "payment before cancel",
  );
  ok(await cancelBooking(cancelled.booking.id, { by: "guest" }, at(addDays(T, -3))), "cancel");
  const token = await issueGuestToken(confirmed.booking.id);

  // Expenses, last month and this one, some with a receipt photo.
  const category = async (key: string) => (await systemCategory(key)).id;
  const expenses: [string, string, number, number, string, [string, string][] | null][] = [
    [lake.id, "cleaning", 6_500, -3, "Endreinigung Becker", null],
    [
      lake.id,
      "supplies",
      4_245,
      -6,
      "Baumarkt: Glühbirnen, Batterien",
      [
        ["Glühbirnen 4x", "12,96"],
        ["Batterien AA", "7,49"],
        ["Gartenschlauch", "21,99"],
        ["Summe EUR", "42,44"],
      ],
    ],
    [
      cabin.id,
      "maintenance",
      18_900,
      -11,
      "Schornsteinfeger",
      [
        ["Kehrung", "158,82"],
        ["MwSt 19 %", "30,18"],
        ["Summe EUR", "189,00"],
      ],
    ],
    [cabin.id, "cleaning", 9_000, -14, "Reinigung nach Abreise", null],
    [lake.id, "platform_fees", 3_870, -18, "Airbnb Servicegebühr", null],
    [
      cabin.id,
      "supplies",
      2_780,
      -22,
      "Kaminholz",
      [
        ["Buche 1 RM", "27,80"],
        ["Summe EUR", "27,80"],
      ],
    ],
    [lake.id, "maintenance", 24_000, -27, "Steg ausgebessert", null],
    [cabin.id, "other_expenses", 1_500, -33, "Schlüsselkasten", null],
    [lake.id, "cleaning", 6_500, -38, "Endreinigung", null],
  ];
  for (const [propertyId, key, amountMinor, back, description, receipt] of expenses) {
    const { transaction } = ok(
      await createTransaction(
        createTransactionSchema.parse({
          propertyId,
          type: "expense",
          categoryId: await category(key),
          amountMinor,
          date: addDays(T, back),
          description,
          isRecurring: false,
        }),
      ),
      `expense ${description}`,
    ) as { transaction: { id: string } };
    if (receipt) {
      const bytes = await receiptPhoto(description.split(":")[0]!, receipt);
      ok(await addReceipt(transaction.id, { name: "Beleg.jpg", bytes }), "receipt");
    }
  }
  ok(
    await createTransaction(
      createTransactionSchema.parse({
        propertyId: lake.id,
        type: "income",
        categoryId: await category("other_income"),
        amountMinor: 3_000,
        date: addDays(T, -16),
        description: "Fahrradverleih",
        isRecurring: false,
      }),
    ),
    "other income",
  );

  // Recurring costs, started months ago so some entries already exist.
  const monthsAgo = (n: number) => {
    const d = new Date(`${T}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - n, 1);
    return d.toISOString().slice(0, 10);
  };
  for (const [propertyId, key, amountMinor, interval, start, description] of [
    [lake.id, "utilities", 8_900, "monthly", monthsAgo(4), "Strom (Stadtwerke)"],
    [cabin.id, "utilities", 3_499, "monthly", monthsAgo(4), "Internet"],
    [lake.id, "insurance", 41_200, "annual", monthsAgo(2), "Wohngebäudeversicherung"],
    [cabin.id, "taxes", 12_300, "quarterly", monthsAgo(5), "Grundsteuer"],
  ] as const) {
    ok(
      await createRecurringExpense(
        createRecurringExpenseSchema.parse({
          propertyId,
          categoryId: await category(key),
          amountMinor,
          interval,
          startDate: start,
          endDate: null,
          description,
        }),
      ),
      `recurring ${description}`,
    );
  }

  const manifest = {
    today: T,
    lake: { id: lake.id, slug: "haus-am-see" },
    cabin: { id: cabin.id, slug: "berghuette" },
    bookings: {
      current: current.id,
      reserved: reserved.booking.id,
      confirmed: confirmed.booking.id,
      cancelled: cancelled.booking.id,
    },
    guest: guests[3]!.id,
    guestPath: `/stay/booking/${token}`,
  };
  await mkdir(dirname(MANIFEST), { recursive: true });
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(`UX review data seeded for ${T}.`);
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
