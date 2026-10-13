/**
 * Erasure of a guest's personal data (DSGVO Art. 17). Server-side only.
 *
 * A guest with bookings is ANONYMISED in place, not deleted: bookings and
 * their amounts are accounting records that must be kept (AO §147, and
 * Art. 17(3)(b) DSGVO), and they reference the guest. In one transaction:
 * - the guest's name becomes a neutral placeholder and email, phone and
 *   notes are cleared; `purgedAt` is set;
 * - the personal data a booking row can hold is cleared: its free-text
 *   notes, and for a request from the public site (GitLab #109) the
 *   guest's message and the name and phone given with it. Otherwise a
 *   booking references the guest by id only;
 * - an audit event records that it happened, when and by whom, without any
 *   of the removed data.
 * A guest without bookings is simply deleted, with the same audit event.
 *
 * Afterwards the guest is read-only, never found by search, and cannot be
 * given new bookings. Purging again is harmless.
 *
 * NOT REACHED by a purge, by design:
 * - Google Calendar: events pushed by outbound sync (src/lib/google/outbound.ts)
 *   carry no guest personal data - only the property, booking id, nights,
 *   guest count and total - so there is nothing in Google to erase.
 * - Logs and error reports: the app does not log guest records; email
 *   addresses and phone fields are masked anyway (src/lib/scrub.ts), and
 *   request bodies are never sent to the error tracker. A guest's NAME is
 *   not pattern-masked, so it must never be logged.
 * - Backups: the data disappears from them once backup retention passes;
 *   the backup procedure (GitLab #95) documents that period.
 */
import type { Guest } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { clearWindows } from "@/lib/availability/cache";
import { db } from "@/lib/db";

import { PURGED_GUEST_NAME } from "./display";

export { PURGED_GUEST_NAME };

export type PurgeResult =
  | { outcome: "anonymised"; guest: Guest; bookings: number }
  | { outcome: "deleted" }
  | { outcome: "already_purged"; guest: Guest }
  | { outcome: "not_found" };

export async function purgeGuest(id: string, actorUserId: string | null): Promise<PurgeResult> {
  const result = await purgeInTransaction(id, actorUserId);
  // Cached calendar windows show guest names: none may outlive the erasure.
  if (result.outcome === "anonymised") clearWindows();
  return result;
}

async function purgeInTransaction(id: string, actorUserId: string | null): Promise<PurgeResult> {
  return db.$transaction(async (tx) => {
    // Locked, so no edit or new booking can slip in while the purge runs: the
    // bookings trigger share-locks the guest row before attaching anything to
    // it, so it waits for this and then refuses an erased guest.
    const [row] = await tx.$queryRaw<{ purged_at: Date | null }[]>`
      SELECT purged_at FROM guests WHERE id = ${id}::uuid FOR UPDATE`;
    if (!row) {
      // Erased earlier by deletion? Then repeating is harmless, as promised.
      const deleted = await tx.auditEvent.findFirst({
        where: { action: "guest.deleted", subjectType: "guest", subjectId: id },
        select: { id: true },
      });
      return deleted ? { outcome: "deleted" } : { outcome: "not_found" };
    }
    if (row.purged_at) {
      return {
        outcome: "already_purged",
        guest: await tx.guest.findUniqueOrThrow({ where: { id } }),
      };
    }

    const bookings = await tx.booking.count({ where: { guestId: id } });
    if (bookings === 0) {
      await tx.guest.delete({ where: { id } });
      await recordAudit(
        {
          action: "guest.deleted",
          subjectType: "guest",
          subjectId: id,
          actorUserId,
          details: { erasure: true },
        },
        tx,
      );
      return { outcome: "deleted" };
    }

    const { count: notesCleared } = await tx.booking.updateMany({
      where: { guestId: id, notes: { not: null } },
      data: { notes: null },
    });
    await tx.booking.updateMany({
      where: {
        guestId: id,
        OR: [
          { guestMessage: { not: null } },
          { requesterName: { not: null } },
          { requesterPhone: { not: null } },
        ],
      },
      data: { guestMessage: null, requesterName: null, requesterPhone: null },
    });
    const guest = await tx.guest.update({
      where: { id },
      data: {
        name: PURGED_GUEST_NAME,
        email: null,
        phone: null,
        notes: null,
        purgedAt: new Date(),
      },
    });
    await recordAudit(
      {
        action: "guest.purged",
        subjectType: "guest",
        subjectId: id,
        actorUserId,
        details: { bookings, bookingNotesCleared: notesCleared },
      },
      tx,
    );
    return { outcome: "anonymised", guest, bookings };
  });
}
