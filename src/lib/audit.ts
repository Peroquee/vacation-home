/**
 * The audit trail: that something happened, when and by whom - never the
 * data involved. Append-only; the database refuses updates and deletes.
 */
import type { Prisma } from "@/generated/prisma/client";
import { db, type DbClient } from "@/lib/db";

export type AuditAction = "guest.purged" | "guest.deleted";

export async function recordAudit(
  event: {
    action: AuditAction;
    subjectType: "guest";
    subjectId: string;
    actorUserId: string | null;
    /** Counts and flags only. Never names, addresses or free text. */
    details?: Record<string, number | boolean | string>;
  },
  client: DbClient = db,
): Promise<void> {
  await client.auditEvent.create({
    data: { ...event, details: (event.details ?? {}) as Prisma.InputJsonObject },
  });
}
