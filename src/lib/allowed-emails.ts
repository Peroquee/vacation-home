/**
 * Who may use the app (GitLab #122): the fixed AUTH_ALLOWED_EMAILS, which
 * the owner can never lose, and the accounts added in Settings -> Access,
 * kept in the database. Server-side only.
 *
 * The proxy asks on every request, so the added accounts are read once and
 * kept for a short while; adding or removing one here clears that at once
 * (the app runs as one process).
 */
import { env } from "@/env";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";

const normalise = (email: string) => email.trim().toLowerCase();

/** On AUTH_ALLOWED_EMAILS: always allowed, and not removable in the app. */
export function isFixedEmail(email: string | null | undefined): boolean {
  return !!email && env.AUTH_ALLOWED_EMAILS.includes(normalise(email));
}

const CACHE_MS = 30_000;
let cached: { emails: Set<string>; at: number } | null = null;

async function addedEmails(): Promise<Set<string>> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.emails;
  const rows = await db.allowedAccount.findMany({ select: { email: true } });
  cached = { emails: new Set(rows.map((row) => row.email)), at: Date.now() };
  return cached.emails;
}

/** Whether `email` may use the app: fixed or added, in any case. */
export async function isAllowedEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  return isFixedEmail(email) || (await addedEmails()).has(normalise(email));
}

/**
 * An address as the refused sign-in page and the log show it: enough for
 * the person to recognise their account, not the address itself.
 */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = normalise(email).split("@");
  return `${local.slice(0, 1)}…@${domain}`;
}

/** A masked address as maskEmail makes them, and nothing else (it comes back in a URL). */
export const MASKED_EMAIL = /^[a-z0-9._%+-]…@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export type AllowedAccount = { id: string | null; email: string; fixed: boolean };

/** Everyone who may sign in: the fixed addresses first, then the added ones. */
export async function listAllowedAccounts(): Promise<AllowedAccount[]> {
  const rows = await db.allowedAccount.findMany({ orderBy: { email: "asc" } });
  return [
    ...env.AUTH_ALLOWED_EMAILS.map((email) => ({ id: null, email, fixed: true })),
    ...rows
      .filter((row) => !isFixedEmail(row.email))
      .map((row) => ({ id: row.id, email: row.email, fixed: false })),
  ];
}

/** Adds an account; "exists" when it may sign in already. */
export async function addAllowedAccount(
  email: string,
  actorUserId: string | null,
): Promise<AllowedAccount | "exists"> {
  const address = normalise(email);
  if (isFixedEmail(address)) return "exists";
  const existing = await db.allowedAccount.findUnique({ where: { email: address } });
  if (existing) return "exists";
  const row = await db.$transaction(async (tx) => {
    const created = await tx.allowedAccount.upsert({
      where: { email: address },
      create: { email: address },
      update: {},
    });
    await recordAudit(
      {
        action: "access.added",
        subjectType: "allowed_account",
        subjectId: created.id,
        actorUserId,
      },
      tx,
    );
    return created;
  });
  cached = null;
  return { id: row.id, email: row.email, fixed: false };
}

export type RemoveResult = "removed" | "not_found" | "yourself" | "last";

/**
 * Removes an added account, never the caller's own nor the last one
 * left, and ends that account's sessions at once. Both changes go in the
 * audit trail (without the address).
 */
export async function removeAllowedAccount(
  id: string,
  current: { id: string; email: string },
): Promise<RemoveResult> {
  const row = await db.allowedAccount.findUnique({ where: { id } });
  if (!row) return "not_found";
  if (row.email === normalise(current.email)) return "yourself";
  const total = env.AUTH_ALLOWED_EMAILS.length + (await db.allowedAccount.count());
  if (total <= 1) return "last";
  await db.$transaction(async (tx) => {
    await tx.allowedAccount.delete({ where: { id } });
    await tx.session.deleteMany({
      where: { user: { email: { equals: row.email, mode: "insensitive" } } },
    });
    await recordAudit(
      {
        action: "access.removed",
        subjectType: "allowed_account",
        subjectId: id,
        actorUserId: current.id,
      },
      tx,
    );
  });
  cached = null;
  return "removed";
}
