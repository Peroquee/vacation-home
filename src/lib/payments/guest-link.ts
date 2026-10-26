/**
 * The guest's link to their booking (GitLab #115): /stay/booking/<token>,
 * showing its status, what to pay, by when and to whom. Server-side only.
 *
 * The token is 128 random bits (base64url); only its SHA-256 is stored, so
 * the database - or a backup of it - cannot open any booking. Each call
 * makes a new token: the owner can give the guest a link again (and the
 * emails each carry their own, GitLab #111). The booking's reference never
 * opens anything: it is printed on bank transfers.
 */
import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { db } from "@/lib/db";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** A token's shape: 22 base64url characters (128 bits). */
export const TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** A new link token for the booking; only its hash is stored. */
export async function issueGuestToken(bookingId: string): Promise<string> {
  const token = randomBytes(16).toString("base64url");
  await db.guestAccessToken.create({ data: { bookingId, tokenHash: hash(token) } });
  return token;
}

/** The booking a token opens, or null. */
export async function bookingForToken(token: string): Promise<string | null> {
  if (!TOKEN.test(token)) return null;
  const row = await db.guestAccessToken.findUnique({
    where: { tokenHash: hash(token) },
    select: { bookingId: true },
  });
  return row?.bookingId ?? null;
}

/** The path of the guest's page for a token. */
export const guestPath = (token: string) => `/stay/booking/${token}`;
