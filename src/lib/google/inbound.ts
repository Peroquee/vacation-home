/**
 * Inbound sync, part one (GitLab #72): finding out what changed in a
 * property's Google Calendar. Server-side only.
 *
 * **Polling is the default.** The app is normally reachable on the LAN
 * only, where Google cannot deliver a webhook, so every calendar with
 * inbound sync on is checked every GOOGLE_CALENDAR_POLL_SECONDS (default
 * 5 minutes) with an incremental list: Google's sync token returns only what
 * changed since the last list, deletions included.
 *
 * **Push is optional.** With GOOGLE_WEBHOOK_URL set (a public https URL),
 * each watched calendar also gets a push channel, renewed a day before it
 * expires. A notification only makes the next poll happen at once (see
 * /api/google/webhook); polling continues hourly as the safety net.
 *
 * **No data loss.** The changes go to the import (./inbound-import.ts, GitLab
 * #73) before the new sync token is stored, so a failed import is simply
 * retried from the same point. An expired or invalidated sync token (410)
 * triggers a full list, which the import treats as the whole truth.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { env } from "@/env";
import type { CalendarWatch } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { Logger } from "@/lib/logger";
import { logger as rootLogger } from "@/lib/logger";

import {
  type CalendarClient,
  type CalendarEvent,
  createCalendarClient,
  GoogleCalendarError,
} from "./calendar";
import { getConnectionStatus } from "./connection";
import { importInboundEvents } from "./inbound-import";
import { errorKind, retryDelayMs } from "./links";

export const WEBHOOK_PATH = "/api/google/webhook";

/** With push notifications, polling is only the safety net. */
const POLL_WITH_CHANNEL_MS = 60 * 60_000;
/** A worker's lease on a claimed watch. */
const LEASE_MS = 10 * 60_000;
/** How long to wait while the Google account is disconnected. */
const DEFER_MS = 15 * 60_000;
/** Channels live a week and are replaced a day before they expire. */
const CHANNEL_TTL_SECONDS = 7 * 24 * 60 * 60;
const RENEW_BEFORE_MS = 24 * 60 * 60_000;

export type InboundBatch = {
  propertyId: string;
  calendarId: string;
  /** Changed events (deleted ones with `status: "cancelled"`), or with `full`, all of them. */
  events: CalendarEvent[];
  /** A full list: anything not in it no longer exists in Google. */
  full: boolean;
};

export type InboundHandler = (batch: InboundBatch) => Promise<void>;

const sha256 = (value: string) => createHash("sha256").update(value).digest("base64url");

/**
 * Makes the watches match the settings: one per property with inbound sync
 * on, starting afresh when its calendar changed; none for the others.
 * Returns the channels of removed or reset watches, to stop at Google.
 */
export async function reconcileWatches(
  now = new Date(),
): Promise<{ userId: string; channelId: string; resourceId: string }[]> {
  const [configs, watches] = await Promise.all([
    db.propertyCalendar.findMany({ where: { inbound: true } }),
    db.calendarWatch.findMany({ include: { property: { select: { calendar: true } } } }),
  ]);
  const wanted = new Map(configs.map((c) => [c.propertyId, c]));
  const stale: { userId: string; channelId: string; resourceId: string }[] = [];
  const channelOf = (watch: CalendarWatch, userId: string | undefined) => {
    if (watch.channelId && watch.channelResourceId && userId) {
      stale.push({ userId, channelId: watch.channelId, resourceId: watch.channelResourceId });
    }
  };

  for (const watch of watches) {
    const config = wanted.get(watch.propertyId);
    if (!config) {
      channelOf(watch, watch.property.calendar?.userId);
      await db.calendarWatch.deleteMany({ where: { propertyId: watch.propertyId } });
    } else if (config.calendarId !== watch.calendarId) {
      channelOf(watch, config.userId);
      await db.calendarWatch.update({
        where: { propertyId: watch.propertyId },
        data: {
          calendarId: config.calendarId,
          ...noChannel,
          syncToken: null,
          nextPollAt: now,
          attempts: 0,
          lastError: null,
        },
      });
    }
  }
  const known = new Set(watches.map((w) => w.propertyId));
  const missing = configs.filter((c) => !known.has(c.propertyId));
  if (missing.length > 0) {
    await db.calendarWatch.createMany({
      data: missing.map((c) => ({
        propertyId: c.propertyId,
        calendarId: c.calendarId,
        nextPollAt: now,
      })),
      skipDuplicates: true,
    });
  }
  return stale;
}

const noChannel = {
  channelId: null,
  channelResourceId: null,
  channelTokenHash: null,
  channelExpiresAt: null,
};

/** Claims due watches with a lease, so two workers never poll the same one. */
async function claimDueWatches(now: Date, limit: number): Promise<CalendarWatch[]> {
  const until = new Date(now.getTime() + LEASE_MS);
  const rows = await db.$queryRaw<{ property_id: string }[]>`
    UPDATE calendar_watches SET claimed_until = ${until}
    WHERE property_id IN (
      SELECT property_id FROM calendar_watches
      WHERE next_poll_at <= ${now} AND (claimed_until IS NULL OR claimed_until < ${now})
      ORDER BY next_poll_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING property_id`;
  return db.calendarWatch.findMany({
    where: { propertyId: { in: rows.map((r) => r.property_id) } },
  });
}

/** Every event changed since the sync token, or all of them; the token for next time. */
async function listChanges(
  calendar: CalendarClient,
  calendarId: string,
  syncToken: string | null,
): Promise<{ events: CalendarEvent[]; nextSyncToken: string; full: boolean }> {
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;
  for (;;) {
    const page = await calendar.listEvents(calendarId, {
      ...(syncToken ? { syncToken } : {}),
      pageToken,
      singleEvents: true,
      showDeleted: Boolean(syncToken),
      maxResults: 250,
    });
    events.push(...page.items);
    if (page.nextPageToken) {
      pageToken = page.nextPageToken;
      continue;
    }
    if (!page.nextSyncToken) throw new GoogleCalendarError("server_error", 200, "no_sync_token", 1);
    return { events, nextSyncToken: page.nextSyncToken, full: !syncToken };
  }
}

export type PollOptions = {
  now?: () => Date;
  calendarFor?: (userId: string, log: Logger) => CalendarClient;
  handler?: InboundHandler;
  log?: Logger;
};

export type PollRun = {
  polled: number;
  full: number;
  changes: number;
  failed: number;
  deferred: number;
};

/** Polls every due watch. Failures are recorded with a backoff and counted, never thrown. */
export async function pollDueWatches(options: PollOptions = {}): Promise<PollRun> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? rootLogger;
  const calendarFor =
    options.calendarFor ?? ((userId: string, log: Logger) => createCalendarClient({ userId, log }));
  const handler = options.handler ?? importInboundEvents;
  const run: PollRun = { polled: 0, full: 0, changes: 0, failed: 0, deferred: 0 };

  for (const stale of await reconcileWatches(now())) {
    await calendarFor(stale.userId, log)
      .stopChannel({ id: stale.channelId, resourceId: stale.resourceId })
      .catch(() => {});
  }

  for (;;) {
    const watches = await claimDueWatches(now(), 10);
    if (watches.length === 0) return run;
    for (const watch of watches) await pollWatch(watch);
  }

  async function pollWatch(watch: CalendarWatch) {
    const ids = { propertyId: watch.propertyId, calendarId: watch.calendarId };
    const sameWatch = { propertyId: watch.propertyId, calendarId: watch.calendarId };
    const config = await db.propertyCalendar.findUnique({
      where: { propertyId: watch.propertyId },
    });
    if (!config?.inbound || config.calendarId !== watch.calendarId) {
      // Changed since the claim: the next reconcile sorts it out.
      await db.calendarWatch.updateMany({ where: sameWatch, data: { claimedUntil: null } });
      return;
    }
    if ((await getConnectionStatus(config.userId)).status !== "connected") {
      await db.calendarWatch.updateMany({
        where: sameWatch,
        data: {
          claimedUntil: null,
          lastError: "not_connected",
          nextPollAt: new Date(now().getTime() + DEFER_MS),
        },
      });
      run.deferred++;
      return;
    }

    const calendar = calendarFor(config.userId, log);
    try {
      let changes;
      try {
        changes = await listChanges(calendar, watch.calendarId, watch.syncToken);
      } catch (error) {
        // An expired or invalidated sync token: start over with a full list.
        if (!(error instanceof GoogleCalendarError && error.kind === "gone" && watch.syncToken)) {
          throw error;
        }
        log.warn(ids, "google sync token expired; doing a full resync");
        changes = await listChanges(calendar, watch.calendarId, null);
      }

      await handler({
        propertyId: watch.propertyId,
        calendarId: watch.calendarId,
        events: changes.events,
        full: changes.full,
      });

      const channel = env.GOOGLE_WEBHOOK_URL ? await ensureChannel(watch, calendar) : noChannel;
      const interval = channel.channelId
        ? POLL_WITH_CHANNEL_MS
        : env.GOOGLE_CALENDAR_POLL_SECONDS * 1000;
      const polledAt = now();
      await db.calendarWatch.updateMany({
        where: sameWatch,
        data: {
          syncToken: changes.nextSyncToken,
          lastPolledAt: polledAt,
          ...(changes.full && { lastFullSyncAt: polledAt }),
          nextPollAt: new Date(polledAt.getTime() + interval),
          attempts: 0,
          lastError: null,
          claimedUntil: null,
          ...channel,
        },
      });
      run.polled++;
      if (changes.full) run.full++;
      run.changes += changes.events.length;
      log.info(
        { ...ids, changes: changes.events.length, full: changes.full },
        "google calendar polled",
      );
    } catch (error) {
      const attempts = watch.attempts + 1;
      await db.calendarWatch.updateMany({
        where: sameWatch,
        data: {
          attempts,
          lastError: errorKind(error),
          nextPollAt: new Date(now().getTime() + retryDelayMs(attempts)),
          claimedUntil: null,
        },
      });
      run.failed++;
      log.warn({ ...ids, kind: errorKind(error) }, "google calendar poll failed; will retry");
    }
  }

  /**
   * The watch's push channel, created or renewed when it is missing or
   * expires within a day. The replaced one is stopped (best effort).
   */
  async function ensureChannel(watch: CalendarWatch, calendar: CalendarClient) {
    const current = {
      channelId: watch.channelId,
      channelResourceId: watch.channelResourceId,
      channelTokenHash: watch.channelTokenHash,
      channelExpiresAt: watch.channelExpiresAt,
    };
    if (
      watch.channelId &&
      watch.channelExpiresAt &&
      watch.channelExpiresAt.getTime() - RENEW_BEFORE_MS > now().getTime()
    ) {
      return current;
    }
    try {
      const id = crypto.randomUUID();
      const token = randomBytes(32).toString("base64url");
      const created = await calendar.watchEvents(watch.calendarId, {
        id,
        token,
        address: new URL(WEBHOOK_PATH, env.GOOGLE_WEBHOOK_URL).toString(),
        ttlSeconds: CHANNEL_TTL_SECONDS,
      });
      if (watch.channelId && watch.channelResourceId) {
        await calendar
          .stopChannel({ id: watch.channelId, resourceId: watch.channelResourceId })
          .catch(() => {});
      }
      return {
        channelId: id,
        channelResourceId: created.resourceId,
        channelTokenHash: sha256(token),
        channelExpiresAt: created.expiresAt,
      };
    } catch (error) {
      // Polling carries on regardless; the next poll tries again.
      log.warn(
        { propertyId: watch.propertyId, kind: errorKind(error) },
        "google push channel could not be created",
      );
      return current.channelId && current.channelExpiresAt && current.channelExpiresAt > now()
        ? current
        : noChannel;
    }
  }
}

export type Notification = {
  channelId: string | null;
  token: string | null;
  resourceId: string | null;
  /** `sync` (the channel was just created), `exists` or `not_exists`. */
  state: string | null;
};

/**
 * Handles a push notification: verifies it against the stored channel (id,
 * secret token and resource) and makes the watch due now. Returns whether
 * it was genuine; anything else is refused by the caller.
 */
export async function acceptNotification(notification: Notification): Promise<boolean> {
  const { channelId, token, resourceId, state } = notification;
  if (!channelId || !token || !resourceId) return false;
  const watch = await db.calendarWatch.findUnique({ where: { channelId } });
  if (!watch?.channelTokenHash || watch.channelResourceId !== resourceId) return false;
  const expected = Buffer.from(watch.channelTokenHash);
  const actual = Buffer.from(sha256(token));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  if (watch.channelExpiresAt && watch.channelExpiresAt < new Date()) return false;
  if (state !== "sync") {
    await db.calendarWatch.updateMany({ where: { channelId }, data: { nextPollAt: new Date() } });
  }
  return true;
}
