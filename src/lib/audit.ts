/**
 * The audit trail: that something happened, when and by whom - never the
 * data involved. Append-only; the database refuses updates and deletes.
 */
import type { Prisma } from "@/generated/prisma/client";
import { db, type DbClient } from "@/lib/db";

export type AuditAction =
  | "guest.purged"
  | "guest.deleted"
  // Who may sign in changed (GitLab #122).
  | "access.added"
  | "access.removed";

export async function recordAudit(
  event: {
    action: AuditAction;
    subjectType: "guest" | "allowed_account";
    subjectId: string;
    actorUserId: string | null;
    /**
     * Counts and flags only - deliberately no strings, so no name, address or
     * free text can reach a table that cannot be erased from.
     */
    details?: Record<string, number | boolean>;
  },
  client: DbClient = db,
): Promise<void> {
  await client.auditEvent.create({
    data: { ...event, details: (event.details ?? {}) as Prisma.InputJsonObject },
  });
}
