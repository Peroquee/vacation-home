/**
 * The guests' help on the public pages (GitLab #127): the texts name only
 * what their page provides, the property's real settings show up in them,
 * and a setting that is not there leaves its sentence out.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import de from "../../../messages/de-DE.json";
import en from "../../../messages/en-GB.json";

import { formattersFor } from "@/i18n/format";
import { LOCALES, type Locale } from "@/i18n/locales";
import { NO_STAY_TIMES } from "@/lib/listing/stay-times";
import { DEFAULT_TERMS } from "@/lib/payment-terms/terms";
import type { TouristTaxRules } from "@/lib/pricing/tourist-tax";

import { checkBlocks } from "./blocks";
import { escapeMarkdown, fillValues, placeholdersIn, splitSections } from "./fill";
import {
  type BookingHelpFacts,
  bookingHelp,
  type HelpWords,
  type StayHelpFacts,
  stayHelp,
} from "./guest-values";
import { PUBLIC_HELP, type PublicHelpKey, readPublicHelp } from "./public";

const KEYS = Object.keys(PUBLIC_HELP) as PublicHelpKey[];

function wordsFor(locale: Locale): HelpWords {
  const messages = locale === "en-GB" ? en : de;
  const translator = (namespace: "guestHelp" | "cancellation" | "stayTimes") => {
    const t = createTranslator({ locale, messages, namespace });
    return (key: string, values?: Record<string, string | number>) =>
      t(key as Parameters<typeof t>[0], values);
  };
  const format = formattersFor(locale);
  return {
    t: translator("guestHelp"),
    tCancellation: translator("cancellation"),
    tTimes: translator("stayTimes"),
    money: (minor) => format.money(minor, "EUR"),
    date: (date) => format.date(date, { style: "long" }),
  };
}

/** The help as one text: the title, the intro and every section. */
async function rendered(
  key: PublicHelpKey,
  locale: Locale,
  help: ReturnType<typeof stayHelp>,
): Promise<string> {
  const page = await readPublicHelp(key, locale, help);
  return [
    page.title,
    page.intro,
    ...page.sections.flatMap((s) => [`## ${s.heading}`, s.markdown]),
  ].join("\n");
}

const FACTS: StayHelpFacts = {
  terms: DEFAULT_TERMS,
  currency: "EUR",
  requestExpiryDays: 3,
  touristTax: null,
  times: NO_STAY_TIMES,
  bankDetails: true,
};

const TAX: TouristTaxRules = {
  adultRateMinor: 300,
  childGroups: [
    { fromAge: 0, toAge: 5, rateMinor: 0 },
    { fromAge: 6, toAge: 15, rateMinor: 150 },
  ],
  periods: [],
  maxNights: null,
  included: false,
};

describe("filling in the values", () => {
  it("drops a line that names a missing value, and a section left empty", () => {
    const text = [
      "# Help",
      "Due {when}.",
      "",
      "## Kurtaxe",
      "{tax}",
      "## Times",
      "Arrive {arrival}.",
    ].join("\n");
    const page = splitSections(fillValues(text, { when: "in 7 days", tax: null }));
    expect(page).toEqual({
      title: "Help",
      intro: "Due in 7 days.",
      sections: [],
    });
    expect(placeholdersIn(text)).toEqual(["when", "tax", "arrival"]);
  });

  it("keeps values plain text", () => {
    expect(fillValues("Pay {x}.", { x: "*all* [now](javascript:x)" })).toBe(
      "Pay \\*all\\* \\[now\\](javascript:x).",
    );
    expect(escapeMarkdown("20% of the total")).toBe("20% of the total");
  });
});

describe.each(KEYS)("the %s texts", (key) => {
  const { flags, values } = PUBLIC_HELP[key];
  const texts = LOCALES.map((locale) => ({
    locale,
    text: readFileSync(join(process.cwd(), "help", locale, `${key}.md`), "utf8"),
  }));

  it.each(texts)("in $locale name only what the page provides, all of it", ({ text }) => {
    expect(checkBlocks(text, flags)).toEqual([]);
    expect(placeholdersIn(text).sort()).toEqual([...values].sort());
  });
});

describe("the property page's help", () => {
  it("shows the deposit and its deadline as set", async () => {
    const terms = { ...DEFAULT_TERMS, depositPercent: 30, depositDueDays: 10 };
    const en = await rendered(
      "public-stay",
      "en-GB",
      stayHelp({ ...FACTS, terms }, wordsFor("en-GB")),
    );
    expect(en).toContain(
      "you transfer the deposit of 30% of the total within 10 days of our acceptance",
    );
    expect(en).not.toContain("20%");
    const de = await rendered(
      "public-stay",
      "de-DE",
      stayHelp({ ...FACTS, terms }, wordsFor("de-DE")),
    );
    expect(de).toContain(
      "Sie überweisen die Anzahlung von 30 % des Gesamtpreises innerhalb von 10 Tagen nach unserer Zusage",
    );

    const fixed = { ...DEFAULT_TERMS, depositPercent: null, depositFixedMinor: 25_000 };
    expect(
      await rendered(
        "public-stay",
        "en-GB",
        stayHelp({ ...FACTS, terms: fixed }, wordsFor("en-GB")),
      ),
    ).toContain("the deposit of €250.00 within 7 days");
  });

  it("gives the balance, short notice, answer time and cancellation by the settings", async () => {
    const terms = {
      ...DEFAULT_TERMS,
      balanceDueDaysBefore: 45,
      fullPaymentDueDays: 2,
      refundSchedule: { freeMonthsBefore: 3, rampMonths: 0, startPercent: 0, endPercent: 50 },
    };
    const text = await rendered(
      "public-stay",
      "en-GB",
      stayHelp({ ...FACTS, terms, requestExpiryDays: 5 }, wordsFor("en-GB")),
    );
    expect(text).toContain("you transfer the rest 45 days before your arrival");
    expect(text).toContain("at most 45 days away");
    expect(text).toContain("the full amount within 2 days of our acceptance");
    expect(text).toContain("we reply within 5 days");
    expect(text).toContain("Free cancellation up to 3 months before arrival");
  });

  it("leaves out what is not set: Kurtaxe, times, balance, bank details", async () => {
    const terms = { ...DEFAULT_TERMS, depositPercent: 100 };
    const text = await rendered(
      "public-stay",
      "en-GB",
      stayHelp({ ...FACTS, terms, bankDetails: false }, wordsFor("en-GB")),
    );
    expect(text).not.toContain("Kurtaxe");
    expect(text).not.toContain("## Arrival and departure");
    expect(text).not.toContain("**Balance:**");
    expect(text).not.toContain("at most");
    expect(text).not.toContain("GiroCode");
    expect(text).not.toContain("bank details");
    // What never depends on a setting stays.
    expect(text).toContain("[privacy policy](/stay/legal/privacy)");
  });

  it("explains the Kurtaxe and the times as set", async () => {
    const times = { checkInTime: "15:00", earliestCheckOutTime: "08:00", checkOutTime: "10:00" };
    const en = await rendered(
      "public-stay",
      "en-GB",
      stayHelp({ ...FACTS, touristTax: TAX, times }, wordsFor("en-GB")),
    );
    expect(en).toContain("comes on top of the price: €3.00 per adult and night.");
    expect(en).toContain("Children aged 0 to 5 stay free. Children aged 6 to 15: €1.50 per night.");
    expect(en).toContain("Arrival from 15:00 · Departure between 08:00 and 10:00");
    expect(en).toContain("GiroCode");
    const included = await rendered(
      "public-stay",
      "de-DE",
      stayHelp({ ...FACTS, touristTax: { ...TAX, included: true } }, wordsFor("de-DE")),
    );
    expect(included).toContain("Die Kurtaxe der Gemeinde ist in den Preisen enthalten.");
  });
});

describe("the guest page's help", () => {
  const BOOKING: BookingHelpFacts = {
    status: "reserved",
    declined: false,
    wasReserved: true,
    reference: "K7MQ2XRP",
    remittance: "Booking K7MQ-2XRP",
    girocode: true,
    next: { amountMinor: 22_000, dueOn: "2026-11-02" },
    answerBy: null,
    contact: "host@example.org",
  };
  const help = (facts: Partial<BookingHelpFacts>, locale: Locale = "en-GB") =>
    rendered("public-booking", locale, bookingHelp({ ...BOOKING, ...facts }, wordsFor(locale)));

  it("tells a reserved guest what to pay, by when, quoting what", async () => {
    const text = await help({});
    expect(text).toContain("**Your next step:** transfer €220.00 by 2 November 2026.");
    expect(text).toContain("Please quote **Booking K7MQ-2XRP** as the payment reference");
    expect(text).toContain("scan the GiroCode");
    expect(text).toContain("## How do I add the stay to my calendar?");
    expect(text).toContain(
      "[host@example.org](mailto:host@example.org), quoting your booking reference K7MQ-2XRP",
    );
    expect(text).not.toContain("We have received your request");
    const de = await help({}, "de-DE");
    // Intl puts a no-break space before the euro sign.
    expect(de).toMatch(
      /\*\*Ihr nächster Schritt:\*\* Überweisen Sie 220,00\s€ bis 2\. November 2026\./,
    );
  });

  it("tells a request when it is answered, and has nothing to pay or add yet", async () => {
    const text = await help({
      status: "inquiry",
      wasReserved: false,
      next: null,
      remittance: null,
      answerBy: "2026-10-24",
    });
    expect(text).toContain("will reply by 24 October 2026");
    expect(text).toContain("You can withdraw your request at any time");
    expect(text).not.toContain("## How do I pay?");
    expect(text).not.toContain("calendar");
  });

  it("tells a declined request, a lapsed one and a lapsed reservation apart", async () => {
    const ended = { next: null, remittance: null };
    expect(await help({ ...ended, status: "cancelled", declined: true })).toContain(
      "we couldn't accept your request",
    );
    expect(await help({ ...ended, status: "cancelled" })).toContain(
      "This booking has been cancelled.",
    );
    expect(await help({ ...ended, status: "expired", wasReserved: false })).toContain(
      "We couldn't answer your request in time",
    );
    const lapsed = await help({ ...ended, status: "expired" });
    expect(lapsed).toContain("The payment didn't arrive in time");
    expect(lapsed).not.toContain("## What if I need to cancel?");
  });

  it("leaves out the contact without an address", async () => {
    expect(await help({ contact: null })).not.toContain("## How do I reach you?");
    expect(await help({ reference: null })).toContain(
      "Write to us at [host@example.org](mailto:host@example.org).",
    );
  });
});
