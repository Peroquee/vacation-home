/**
 * The outbox (GitLab #111): booking events become emails, each sent once to
 * each recipient, without ever holding up the request or job that recorded
 * the event. Server-side only.
 *
 * - `enqueue` adds a row per (event, recipient) still missing; the unique
 *   key makes that safe to repeat.
 * - `sendDue` claims due rows (FOR UPDATE SKIP LOCKED, so two runs never
 *   take the same one), writes each email from the booking as it now is,
 *   sends it, and marks it sent. A mail server that fails is tried again
 *   after 1, 5, 15 and 60 minutes, then hourly, and given up on (`failed`)
 *   after a day. An email no longer true, too old, or without an address
 *   is `skipped`, with the reason.
 * - Without SMTP nothing is claimed: the rows wait, and go out once it is
 *   set. The same for the owner's emails without OWNER_EMAIL.
 *
 * Exactly once, as far as SMTP allows: a crash between the server taking a
 * mail and the row being marked sent would send it again on restart. The
 * Message-ID is the same each time (event and recipient), so a mail program
 * shows such a repeat as the same message.
 */
import type { EmailOutbox, EmailRecipient } from "@/generated/prisma/client";
import { env } from "@/env";
import { fromUtcDate } from "@/lib/calendar-date";
import { bookingPolicy } from "@/lib/cancellation/service";
import { db } from "@/lib/db";
import { todayIn } from "@/lib/finance/recurring";
import { logger } from "@/lib/logger";
import { getBankDetails } from "@/lib/payments/bank";
import { guestPath, issueGuestToken } from "@/lib/payments/guest-link";
import { netReceived, nextDue } from "@/lib/payments/service";
import { scrubString } from "@/lib/scrub";

import { irrelevance, MAX_AGE_DAYS, RECIPIENTS } from "./kinds";
import { renderEmail } from "./render";
import { mailTransport, type MailTransport } from "./transport";

const DAY_MS = 86_400_000;
const RETRY_MINUTES = [1, 5, 15, 60];
const GIVE_UP_MS = DAY_MS;
const BATCH = 20;

/** The events whose guest email links to the guest's own page. */
const LINKS_GUEST_PAGE = new Set([
  "reserved",
  "deposit_reminder",
  "deposit_received",
  "balance_reminder",
  "fully_paid",
]);

/** Adds the missing outbox rows for every event; the number added. */
export async function enqueue(): Promise<number> {
  let added = 0;
  for (const [kind, recipients] of Object.entries(RECIPIENTS)) {
    for (const recipient of recipients) {
      added += await db.$executeRaw`
        INSERT INTO email_outbox (event_id, recipient, updated_at)
        SELECT e.id, ${recipient}::email_recipient, now()
        FROM booking_events e
        WHERE e.kind = ${kind}::booking_event_kind
        ON CONFLICT (event_id, recipient) DO NOTHING`;
    }
  }
  return added;
}

export type MailSetup = {
  transport: MailTransport | null;
  from: string | null;
  ownerEmail: string | null;
  appUrl: string;
};

/** The mail setup from the environment: no transport without SMTP_HOST and SMTP_FROM. */
export function mailSetup(): MailSetup {
  return {
    transport: env.SMTP_HOST && env.SMTP_FROM ? mailTransport() : null,
    from: env.SMTP_FROM ?? null,
    ownerEmail: env.OWNER_EMAIL ?? null,
    appUrl: env.APP_URL,
  };
}

export type SendRun = { sent: number; skipped: number; retried: number; failed: number };

type Outcome = { sent: string } | { skipped: string } | { error: string };

/** Writes and sends one email; what came of it. */
async function deliver(row: EmailOutbox, setup: MailSetup, now: Date): Promise<Outcome> {
  const event = await db.bookingEvent.findUnique({
    where: { id: row.eventId },
    include: {
      booking: {
        include: {
          guest: true,
          payments: { select: { kind: true, amountMinor: true } },
          property: { select: { name: true, timezone: true, listing: true } },
        },
      },
    },
  });
  if (!event) return { skipped: "the event is gone" };
  if (now.getTime() - event.createdAt.getTime() > MAX_AGE_DAYS * DAY_MS) {
    return { skipped: `older than ${MAX_AGE_DAYS} days` };
  }
  const { booking } = event;
  const received = netReceived(booking.payments);
  const depositDueOn = booking.depositDueOn && fromUtcDate(booking.depositDueOn);
  const balanceDueOn = booking.balanceDueOn && fromUtcDate(booking.balanceDueOn);
  const stale = irrelevance(event.kind, row.recipient, event.key, {
    status: booking.status,
    reservedAt: booking.reservedAt,
    depositDueOn,
    balanceDueOn,
    totalAmountMinor: booking.totalAmountMinor,
    received,
    today: todayIn(booking.property.timezone, now),
    cancelledBy: booking.cancelledBy,
  });
  if (stale) return { skipped: stale };

  const to = row.recipient === "owner" ? setup.ownerEmail : booking.guest.email;
  if (!to || booking.guest.purgedAt) return { skipped: "no address" };

  const listing = booking.property.listing;
  const titled = listing && (listing.titleEn || listing.titleDe);
  const guestLink =
    row.recipient === "guest" && LINKS_GUEST_PAGE.has(event.kind)
      ? new URL(guestPath(await issueGuestToken(booking.id)), setup.appUrl).toString()
      : null;
  const email = await renderEmail({
    kind: event.kind,
    recipient: row.recipient,
    locale: booking.guestLocale,
    appUrl: setup.appUrl,
    booking: {
      id: booking.id,
      reference: booking.reference,
      checkIn: fromUtcDate(booking.checkIn),
      checkOut: fromUtcDate(booking.checkOut),
      guestCount: booking.guestCount,
      totalAmountMinor: booking.totalAmountMinor,
      touristTaxMinor: booking.touristTaxMinor,
      currency: booking.currency,
      received,
      next: nextDue(
        {
          status: booking.status,
          totalAmountMinor: booking.totalAmountMinor,
          depositAmountMinor: booking.depositAmountMinor,
          depositDueOn,
          balanceDueOn,
        },
        received,
      ),
      declineReason: booking.declineReason,
      guestMessage: booking.guestMessage,
      cancelledBy: booking.cancelledBy,
      refundDueMinor: booking.refundDueMinor,
      policy: await bookingPolicy(booking),
    },
    guestName: booking.requesterName ?? booking.guest.name,
    property: {
      title: titled
        ? { en: listing.titleEn, de: listing.titleDe }
        : { en: booking.property.name, de: "" },
      checkInTime: listing?.checkInTime ?? null,
      checkOutTime: listing?.checkOutTime ?? null,
      houseRules: { en: listing?.houseRulesEn ?? "", de: listing?.houseRulesDe ?? "" },
      exactAddress: listing?.exactAddress ?? "",
      arrivalNotes: listing?.arrivalNotes ?? "",
    },
    bank: await getBankDetails(booking.propertyId),
    guestLink,
  });

  const host = new URL(setup.appUrl).hostname;
  const messageId = `<${event.id}.${row.recipient}@${host}>`;
  try {
    await setup.transport!.sendMail({
      from: setup.from!,
      to,
      ...(row.recipient === "guest" && setup.ownerEmail && { replyTo: setup.ownerEmail }),
      subject: email.subject,
      text: email.text,
      html: email.html,
      attachments: email.attachments,
      messageId,
    });
  } catch (error) {
    return {
      error: scrubString(error instanceof Error ? error.message : String(error)).slice(0, 500),
    };
  }
  return { sent: messageId };
}

/** When to try a row again after `attempts` failures. */
export function retryAt(attempts: number, now: Date): Date {
  const minutes = RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)]!;
  return new Date(now.getTime() + minutes * 60_000);
}

/**
 * Sends what is due at `now`, a batch at a time, until nothing due is left.
 * Does nothing without a transport; leaves the owner's emails waiting
 * without OWNER_EMAIL.
 */
export async function sendDue(setup = mailSetup(), now = new Date()): Promise<SendRun> {
  const run: SendRun = { sent: 0, skipped: 0, retried: 0, failed: 0 };
  if (!setup.transport || !setup.from) return run;
  const recipients: EmailRecipient[] = setup.ownerEmail ? ["guest", "owner"] : ["guest"];

  for (;;) {
    const handled = await db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<EmailOutbox[]>`
          SELECT id, event_id AS "eventId", recipient, status, attempts,
                 next_attempt_at AS "nextAttemptAt", created_at AS "createdAt"
          FROM email_outbox
          WHERE status = 'pending' AND next_attempt_at <= ${now}
            AND recipient::text = ANY(${recipients})
          ORDER BY next_attempt_at, created_at
          LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED`;
        for (const row of rows) {
          const outcome = await deliver(row, setup, now);
          if ("sent" in outcome) {
            await tx.emailOutbox.update({
              where: { id: row.id },
              data: {
                status: "sent",
                sentAt: now,
                messageId: outcome.sent,
                attempts: { increment: 1 },
                lastError: null,
              },
            });
            run.sent++;
          } else if ("skipped" in outcome) {
            await tx.emailOutbox.update({
              where: { id: row.id },
              data: { status: "skipped", skipReason: outcome.skipped },
            });
            run.skipped++;
          } else {
            const attempts = row.attempts + 1;
            const giveUp = now.getTime() - row.createdAt.getTime() >= GIVE_UP_MS;
            await tx.emailOutbox.update({
              where: { id: row.id },
              data: {
                attempts,
                lastError: outcome.error,
                ...(giveUp ? { status: "failed" } : { nextAttemptAt: retryAt(attempts, now) }),
              },
            });
            if (giveUp) run.failed++;
            else run.retried++;
            logger.warn({ outboxId: row.id, attempts, err: outcome.error }, "email not sent");
          }
        }
        return rows.length;
      },
      { maxWait: 5_000, timeout: 120_000 },
    );
    if (handled < BATCH) return run;
  }
}

export type OutboxStatus = {
  smtp: boolean;
  ownerEmail: boolean;
  counts: Record<"pending" | "sent" | "failed" | "skipped", number>;
  /** Recent problems: failed, retrying and skipped emails. */
  problems: {
    id: string;
    bookingId: string;
    kind: string;
    recipient: EmailRecipient;
    status: string;
    reason: string | null;
    attempts: number;
    updatedAt: string;
  }[];
};

/** For the settings page: is mail set up, and what is waiting or went wrong. */
export async function outboxStatus(setup = mailSetup()): Promise<OutboxStatus> {
  const grouped = await db.emailOutbox.groupBy({ by: ["status"], _count: true });
  const counts = { pending: 0, sent: 0, failed: 0, skipped: 0 };
  for (const group of grouped) counts[group.status] = group._count;
  const rows = await db.emailOutbox.findMany({
    where: {
      OR: [{ status: { in: ["failed", "skipped"] } }, { status: "pending", attempts: { gt: 0 } }],
    },
    include: { event: { select: { kind: true, bookingId: true } } },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  return {
    smtp: setup.transport !== null,
    ownerEmail: setup.ownerEmail !== null,
    counts,
    problems: rows.map((row) => ({
      id: row.id,
      bookingId: row.event.bookingId,
      kind: row.event.kind,
      recipient: row.recipient,
      status: row.status,
      reason: row.skipReason ?? row.lastError,
      attempts: row.attempts,
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}
