/**
 * The outbound sync summary shown in the sync settings: how the user's
 * booking events stand in Google. Server-side only.
 */
import { db } from "@/lib/db";

import { openIssueCount } from "./sync-issues";

/**
 * What each recorded error kind means, for people. Links store only the
 * kind (an error code, never Google's text), so these fixed sentences are
 * all that is ever shown: no guest data, no tokens.
 */
const MESSAGES: Record<string, string> = {
  rate_limited: "Google is limiting requests for now; the app retries automatically.",
  quota_exceeded: "The daily Google Calendar quota is used up; the app retries later.",
  server_error: "Google Calendar had a temporary problem; the app retries automatically.",
  network_error: "Google could not be reached; the app retries automatically.",
  unauthorized: "Google refused the app's access; try reconnecting Google Calendar.",
  not_connected: "Google Calendar is not connected; reconnect it to resume syncing.",
  forbidden: "The app may not write to this calendar; choose a calendar you can edit.",
  not_found: "The calendar was not found in Google; choose the calendar again.",
  bad_request: "Google rejected an event; the app retries, and the error is logged.",
};
const FALLBACK = "Syncing an event failed; the app retries automatically.";

export function errorMessage(kind: string | null): string | null {
  return kind === null ? null : (MESSAGES[kind] ?? FALLBACK);
}

export type SyncSummary = {
  /** The most recent successful push, ISO 8601. */
  lastSyncedAt: string | null;
  /** Events waiting to be pushed or deleted. */
  pending: number;
  /** Events whose last attempt failed (they are retried). */
  failed: number;
  /** The most recent failure, as a short sentence. */
  lastError: string | null;
  /** Sync issues waiting for review (GET /api/calendar-sync/issues). */
  openIssues: number;
  /** Of `failed`: given up on, waiting for a manual retry. */
  dead: number;
  /** When the oldest failure still unresolved began. */
  failingSince: string | null;
  /** Failing for over an hour: show a persistent banner. */
  alert: boolean;
};

/** How long failures last before the banner shows. */
const ALERT_AFTER_MS = 60 * 60_000;

/** The summary over every booking event the user's connection writes. */
export async function syncSummary(userId: string): Promise<SyncSummary> {
  const where = { userId };
  const [last, pending, failed, latestFailure, openIssues, dead, oldest] = await Promise.all([
    db.calendarEventLink.aggregate({ where, _max: { lastSyncedAt: true } }),
    db.calendarEventLink.count({
      where: { ...where, syncState: { in: ["pending", "pending_delete"] } },
    }),
    db.calendarEventLink.count({ where: { ...where, syncState: { in: ["failed", "dead"] } } }),
    db.calendarEventLink.findFirst({
      where: { ...where, lastError: { not: null }, syncState: { not: "synced" } },
      orderBy: { updatedAt: "desc" },
      select: { lastError: true },
    }),
    openIssueCount(userId),
    db.calendarEventLink.count({ where: { ...where, syncState: "dead" } }),
    db.calendarEventLink.aggregate({
      where: { ...where, syncState: { not: "synced" }, failingSince: { not: null } },
      _min: { failingSince: true },
    }),
  ]);
  const failingSince = oldest._min.failingSince;
  return {
    lastSyncedAt: last._max.lastSyncedAt?.toISOString() ?? null,
    pending,
    failed,
    lastError: errorMessage(latestFailure?.lastError ?? null),
    openIssues,
    dead,
    failingSince: failingSince?.toISOString() ?? null,
    alert: failingSince !== null && Date.now() - failingSince.getTime() > ALERT_AFTER_MS,
  };
}
