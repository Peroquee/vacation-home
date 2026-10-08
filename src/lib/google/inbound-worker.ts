/**
 * Runs inbound polling (./inbound.ts) in the server process: a check for
 * due calendars every 30 seconds, and at once after a push notification.
 * One run at a time per process; database leases keep other processes off
 * the same calendar. Server-side only.
 */
import { runJob } from "@/lib/jobs";
import { logger } from "@/lib/logger";

import { calendarConnectAvailable } from "./connection";
import { pollDueWatches } from "./inbound";

const TICK_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<void> | null = null;
let again = false;

async function runOnce(): Promise<void> {
  do {
    again = false;
    const run = await pollDueWatches();
    if (run.polled + run.failed + run.deferred > 0) {
      await runJob("gcal.inbound-poll", {}, async (log) => log.info(run, "inbound poll run"));
    }
  } while (again);
}

/** Polls due calendars now, or right after the current run. Never throws. */
export function kickInboundPoll(): void {
  if (!timer) return;
  if (running) {
    again = true;
    return;
  }
  running = runOnce()
    .catch((err: unknown) => logger.error({ err }, "inbound poll run failed"))
    .finally(() => {
      running = null;
    });
}

/** Starts the timer; called once at server start. */
export function startInboundPollWorker(): void {
  if (timer || !calendarConnectAvailable()) return;
  timer = setInterval(kickInboundPoll, TICK_MS);
  timer.unref?.();
  kickInboundPoll();
}
