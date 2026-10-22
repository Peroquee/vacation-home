/**
 * The SMTP transport for the outbox (GitLab #111), from the environment.
 * Server-side only. STARTTLS is required unless SMTP_SECURE asks for
 * implicit TLS: credentials never cross the network in the clear.
 */
import nodemailer from "nodemailer";

import { env } from "@/env";

/** What the outbox needs of a transport; tests pass their own. */
export type MailTransport = {
  sendMail(message: {
    from: string;
    to: string;
    replyTo?: string;
    subject: string;
    text: string;
    html: string;
    attachments: { filename: string; content: Buffer; cid?: string; contentType: string }[];
    messageId: string;
  }): Promise<unknown>;
};

let transport: MailTransport | null = null;

/**
 * The longest one send can wait on a silent server: connecting, the
 * greeting, and the longest pause mid-conversation (GitLab #134). Nodemailer
 * waits up to ten minutes for each by default. The outbox claims an email
 * for well over this, so no other run takes it while it is being sent.
 */
export const SEND_TIMEOUT_MS = 60_000;

export function mailTransport(): MailTransport {
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    requireTLS: !env.SMTP_SECURE && env.SMTP_REQUIRE_TLS,
    ...(env.SMTP_USER && { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" } }),
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    // No file or URL access for message content: only what the app writes.
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return transport;
}
