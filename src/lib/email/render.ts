/**
 * The emails' words and layout (GitLab #111): plain text and simple HTML
 * from the same blocks, in the guest's language. No external images and no
 * tracking: the one image, the GiroCode, travels inline (cid). The footer
 * links the legal pages. Server-side only.
 */
import { createTranslator } from "next-intl";
import QRCode from "qrcode";

import type { BookingEventKind, EmailRecipient } from "@/generated/prisma/client";
import { formattersFor } from "@/i18n/format";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";
import { formatReference } from "@/lib/booking-requests/values";
import { type CalendarDate, daysBetween } from "@/lib/calendar-date";
import type { BankDetails } from "@/lib/payments/bank";
import { epcPayload, remittanceFor } from "@/lib/payments/girocode";
import { formatIban } from "@/lib/payments/iban";
import type { NextDue } from "@/lib/payments/service";

import de from "../../../messages/de-DE.json";
import en from "../../../messages/en-GB.json";

const MESSAGES = { "de-DE": de, "en-GB": en } as const;

export type EmailContext = {
  kind: BookingEventKind;
  recipient: EmailRecipient;
  /** The guest's page language, from their request; the default otherwise. */
  locale: string | null;
  appUrl: string;
  booking: {
    id: string;
    reference: string | null;
    checkIn: CalendarDate;
    checkOut: CalendarDate;
    guestCount: number;
    totalAmountMinor: number;
    currency: string;
    received: number;
    next: NextDue | null;
    declineReason: string | null;
    guestMessage: string | null;
  };
  guestName: string;
  property: {
    title: { en: string; de: string };
    checkInTime: string | null;
    checkOutTime: string | null;
    houseRules: { en: string; de: string };
    exactAddress: string;
    arrivalNotes: string;
  };
  bank: BankDetails | null;
  /** The guest's own page, for the kinds that link it; made at send time. */
  guestLink: string | null;
};

type Block =
  | { p: string }
  | { facts: [string, string][] }
  | { link: string; url: string }
  | { image: string; alt: string }
  | { pre: string };

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; content: Buffer; cid: string; contentType: string }[];
};

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function toText(blocks: Block[]): string {
  return blocks
    .map((block) => {
      if ("p" in block) return block.p;
      if ("pre" in block) return block.pre;
      if ("facts" in block) return block.facts.map(([k, v]) => `${k}: ${v}`).join("\n");
      if ("link" in block) return `${block.link}: ${block.url}`;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function toHtml(blocks: Block[]): string {
  const body = blocks
    .map((block) => {
      if ("p" in block) return `<p>${escape(block.p)}</p>`;
      if ("pre" in block) {
        return `<p style="white-space:pre-line">${escape(block.pre)}</p>`;
      }
      if ("facts" in block) {
        const rows = block.facts
          .map(
            ([k, v]) =>
              `<tr><td style="padding:2px 12px 2px 0;color:#555">${escape(k)}</td><td style="padding:2px 0">${escape(v)}</td></tr>`,
          )
          .join("");
        return `<table role="presentation" style="border-collapse:collapse">${rows}</table>`;
      }
      if ("link" in block) return `<p><a href="${escape(block.url)}">${escape(block.link)}</a></p>`;
      return `<p><img src="cid:${block.image}" alt="${escape(block.alt)}" width="180" height="180"></p>`;
    })
    .join("\n");
  return `<!doctype html><html><body style="font-family:sans-serif;line-height:1.5;color:#111">${body}</body></html>`;
}

/** The email for an event to a recipient. */
export async function renderEmail(context: EmailContext): Promise<RenderedEmail> {
  const locale: Locale =
    context.recipient === "guest" && context.locale && isLocale(context.locale)
      ? context.locale
      : DEFAULT_LOCALE;
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "email" });
  const format = formattersFor(locale);
  const { booking, property } = context;
  const money = (minor: number) => format.money(minor, booking.currency);
  const pick = (text: { en: string; de: string }) =>
    locale.startsWith("de") ? text.de || text.en : text.en || text.de;
  const title = pick(property.title);
  const when = format.dateRange(booking.checkIn, booking.checkOut);

  const stay: Block = {
    facts: [
      [t("facts.home"), title],
      [
        t("facts.dates"),
        `${when} · ${t("facts.nights", { count: daysBetween(booking.checkIn, booking.checkOut) })}`,
      ],
      [t("facts.guests"), String(booking.guestCount)],
      [t("facts.total"), money(booking.totalAmountMinor)],
      ...(booking.reference
        ? ([[t("facts.reference"), formatReference(booking.reference)]] as [string, string][])
        : []),
    ],
  };

  const attachments: RenderedEmail["attachments"] = [];
  const blocks: Block[] = [];
  const hello: Block = { p: t("hello", { name: context.guestName }) };

  /** What to pay next, to whom, with the GiroCode; or that the owner will send the details. */
  async function payment(): Promise<Block[]> {
    const next = booking.next;
    if (!next || next.amountMinor <= 0) return [];
    const due: Block = {
      p: t(`pay.${next.kind}`, {
        amount: money(next.amountMinor),
        date: format.date(next.dueOn, { style: "long" }),
      }),
    };
    if (!context.bank || !booking.reference) return [due, { p: t("pay.detailsFollow") }];
    const remittance = remittanceFor(booking.reference);
    const out: Block[] = [
      due,
      {
        facts: [
          [t("pay.holder"), context.bank.accountHolder],
          ["IBAN", formatIban(context.bank.iban)],
          ...(context.bank.bic ? ([["BIC", context.bank.bic]] as [string, string][]) : []),
          [t("pay.amount"), money(next.amountMinor)],
          [t("pay.remittance"), remittance],
        ],
      },
    ];
    const payload = epcPayload({
      ...context.bank,
      amountMinor: next.amountMinor,
      currency: booking.currency,
      remittance,
    });
    if (payload) {
      attachments.push({
        filename: "girocode.png",
        content: await QRCode.toBuffer(payload, {
          type: "png",
          errorCorrectionLevel: "M",
          margin: 4,
          width: 360,
        }),
        cid: "girocode",
        contentType: "image/png",
      });
      out.push({ image: "girocode", alt: t("pay.girocode") });
    }
    return out;
  }

  const guestLink: Block[] = context.guestLink
    ? [{ link: t("guestLink"), url: context.guestLink }]
    : [];
  const ownerLink = (path: string): Block => ({
    link: t("owner.open"),
    url: new URL(path, context.appUrl).toString(),
  });

  let subject: string;
  if (context.recipient === "owner") {
    const name = context.guestName;
    switch (context.kind) {
      case "requested":
        subject = t("owner.requested.subject", { name, when });
        blocks.push({ p: t("owner.requested.body", { name }) }, stay);
        if (booking.guestMessage) blocks.push({ pre: booking.guestMessage });
        blocks.push(ownerLink("/bookings/requests"));
        break;
      case "reservation_expired":
        subject = t("owner.expired.subject", { name, when });
        blocks.push(
          { p: t("owner.expired.body", { name }) },
          stay,
          ownerLink(`/bookings/${booking.id}`),
        );
        break;
      case "balance_overdue":
        subject = t("owner.overdue.subject", { name, when });
        blocks.push(
          {
            p: t("owner.overdue.body", {
              name,
              outstanding: money(booking.totalAmountMinor - booking.received),
            }),
          },
          stay,
          ownerLink(`/bookings/${booking.id}`),
        );
        break;
      default:
        throw new Error(`no owner email for ${context.kind}`);
    }
  } else {
    switch (context.kind) {
      case "requested":
        subject = t("guest.requested.subject", { title });
        blocks.push(hello, { p: t("guest.requested.body") }, stay, {
          p: t("guest.requested.next"),
        });
        break;
      case "reserved":
        subject = t("guest.reserved.subject", { title });
        blocks.push(
          hello,
          { p: t("guest.reserved.body") },
          stay,
          ...(await payment()),
          {
            p: t("guest.reserved.hold"),
          },
          ...guestLink,
        );
        break;
      case "deposit_reminder":
        subject = t("guest.depositReminder.subject", { title });
        blocks.push(
          hello,
          { p: t("guest.depositReminder.body") },
          ...(await payment()),
          stay,
          ...guestLink,
        );
        break;
      case "reservation_expired":
        subject = t("guest.reservationExpired.subject", { title });
        blocks.push(hello, { p: t("guest.reservationExpired.body") }, stay);
        break;
      case "request_expired":
        subject = t("guest.requestExpired.subject", { title });
        blocks.push(hello, { p: t("guest.requestExpired.body") }, stay);
        break;
      case "declined":
        subject = t("guest.declined.subject", { title });
        blocks.push(hello, { p: t("guest.declined.body") });
        if (booking.declineReason) blocks.push({ pre: booking.declineReason });
        blocks.push(stay);
        break;
      case "deposit_received":
        subject = t("guest.depositReceived.subject", { title });
        blocks.push(
          hello,
          { p: t("guest.depositReceived.body", { received: money(booking.received) }) },
          stay,
          ...(await payment()),
          ...guestLink,
        );
        break;
      case "balance_reminder":
        subject = t("guest.balanceReminder.subject", { title });
        blocks.push(
          hello,
          { p: t("guest.balanceReminder.body") },
          ...(await payment()),
          stay,
          ...guestLink,
        );
        break;
      case "fully_paid": {
        subject = t("guest.paid.subject", { title });
        blocks.push(hello, { p: t("guest.paid.body") }, stay);
        const times = [
          property.checkInTime && t("guest.paid.checkIn", { time: property.checkInTime }),
          property.checkOutTime && t("guest.paid.checkOut", { time: property.checkOutTime }),
        ].filter(Boolean) as string[];
        if (times.length > 0) blocks.push({ p: times.join(" · ") });
        if (property.exactAddress) {
          blocks.push({ p: t("guest.paid.address") }, { pre: property.exactAddress });
        }
        if (property.arrivalNotes) {
          blocks.push({ p: t("guest.paid.arrival") }, { pre: property.arrivalNotes });
        }
        const rules = pick(property.houseRules);
        if (rules) blocks.push({ p: t("guest.paid.rules") }, { pre: rules });
        blocks.push(...guestLink);
        break;
      }
      default:
        throw new Error(`no guest email for ${context.kind}`);
    }
    blocks.push({ p: t("replyHint") });
  }

  // The legal pages, on every email.
  blocks.push({
    pre: [
      `${t("footer.imprint")}: ${new URL("/stay/legal/imprint", context.appUrl)}`,
      `${t("footer.privacy")}: ${new URL("/stay/legal/privacy", context.appUrl)}`,
    ].join("\n"),
  });

  return { subject, text: toText(blocks), html: toHtml(blocks), attachments };
}
