/**
 * The guests' help on the public pages (GitLab #127): Markdown per page and
 * language in help/<locale>/<key>.md, like the owner's help (#121), with the
 * property's real settings filled in (./fill.ts, ./guest-values.ts).
 * Server-side: read while the page renders, so the help needs no client
 * JS. next.config.ts traces the folder into the standalone build.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { getTranslations } from "next-intl/server";

import { getFormat } from "@/i18n/get-format";
import type { Locale } from "@/i18n/locales";

import { type HelpFlags, resolveBlocks } from "./blocks";
import { fillValues, type HelpPage, type HelpValues, splitSections } from "./fill";
import type { HelpWords } from "./guest-values";

/**
 * Each public help text, and the flags and values its page provides. The
 * test holds the files to these, in both languages; scripts/check-help.mjs
 * checks the files are there and agree with each other.
 */
export const PUBLIC_HELP = {
  /** /stay/[slug]: how booking works, with the property's terms. */
  "public-stay": {
    flags: ["girocode", "bank-details"],
    values: [
      "deposit",
      "depositDue",
      "balanceDue",
      "shortNotice",
      "fullDue",
      "requestAnswer",
      "cancellation",
      "touristTax",
      "times",
    ],
  },
  /** /stay/booking/[token]: the booking's status, and what to do next. */
  "public-booking": {
    flags: [
      "inquiry",
      "reserved",
      "confirmed",
      "paid",
      "declined",
      "cancelled",
      "request-expired",
      "reservation-expired",
      "holds",
      "transfer",
      "girocode",
      "reference",
    ],
    values: ["reference", "remittance", "nextAmount", "nextDate", "answerBy", "contact"],
  },
} as const satisfies Record<string, { flags: readonly string[]; values: readonly string[] }>;

export type PublicHelpKey = keyof typeof PUBLIC_HELP;

const HELP_DIR = join(process.cwd(), "help");

/** The help `key` in `locale`, its blocks resolved and its values filled in. */
export async function readPublicHelp(
  key: PublicHelpKey,
  locale: Locale,
  help: { flags: HelpFlags; values: HelpValues },
): Promise<HelpPage> {
  const text = await readFile(join(HELP_DIR, locale, `${key}.md`), "utf8");
  return splitSections(fillValues(resolveBlocks(text, help.flags), help.values));
}

/** The words the values are put in, in the visitor's language, for prices in `currency`. */
export async function helpWords(currency: string): Promise<HelpWords> {
  const [t, tCancellation, tTimes, format] = await Promise.all([
    getTranslations("guestHelp"),
    getTranslations("cancellation"),
    getTranslations("stayTimes"),
    getFormat(),
  ]);
  return {
    t: (key, values) => t(key as Parameters<typeof t>[0], values),
    tCancellation: (key, values) =>
      tCancellation(key as Parameters<typeof tCancellation>[0], values),
    tTimes: (key, values) => tTimes(key as Parameters<typeof tTimes>[0], values),
    money: (minor) => format.money(minor, currency),
    date: (date) => format.date(date, { style: "long" }),
  };
}
