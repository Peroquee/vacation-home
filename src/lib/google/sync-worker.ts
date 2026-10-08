/**
 * Runs outbound sync (./outbound.ts) in the server process: at once after a
 * booking change (`kickOutboundSync`), and every 20 seconds as a fallback
 * that also picks up retries whose backoff has passed. One run at a time per
 * process; a kick during a run queues one more run. Other processes are kept
 * off the same links by the database leases. Server-side only.
 */
import { runJob } from "@/lib/jobs";
import { logger } from "@/lib/logger";

import { calendarConnectAvailable } from "./connection";
import { hasDueLinks, processDueLinks } from "./outbound";

const INTERVAL_MS = 20_000;

let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function runOnce(): Promise<void> {
  do {
    again = false;
    if (!(await hasDueLinks())) continue;
    await runJob("gcal.outbound-sync", {}, async (log) => {
      const run = await processDueLinks({ log });
      log.info(run, "outbound sync run");
    });
  } while (again);
}

/**
 * Starts a sync run now, or right after the current one. Never throws. Does
 * nothing unless the worker was started - in the server process, not in
 * tests or scripts that write bookings.
 */
export function kickOutboundSync(): void {
  if (!timer) return;
  if (running) {
    again = true;
    return;
  }
  running = runOnce()
    .catch((err: unknown) => logger.error({ err }, "outbound sync run failed"))
    .finally(() => {
      running = null;
    });
}

/** Starts the fallback timer; called once at server start. */
export function startOutboundSyncWorker(): void {
  if (timer || !calendarConnectAvailable()) return;
  timer = setInterval(kickOutboundSync, INTERVAL_MS);
  // Never what keeps the process alive.
  timer.unref?.();
  kickOutboundSync();
}

/** For tests: waits for the run in progress, if any. */
export function outboundSyncIdle(): Promise<void> {
  return running ?? Promise.resolve();
}
