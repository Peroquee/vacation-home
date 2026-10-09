/**
 * Runs the iCal feed import (./import.ts) in the server process: a check for
 * due feeds every minute; each feed is fetched every ICAL_POLL_MINUTES.
 * One run at a time per process; claiming a feed keeps other processes off
 * it. Server-side only.
 */
import { runJob } from "@/lib/jobs";
import { logger } from "@/lib/logger";

import { importDueFeeds } from "./import";

const TICK_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function run(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await importDueFeeds();
    if (result.fetched + result.failed > 0) {
      await runJob("ical.import", {}, async (log) => log.info(result, "ical feeds fetched"));
    }
  } catch (err) {
    logger.error({ err }, "ical import run failed");
  } finally {
    running = false;
  }
}

/** Starts the timer; called once at server start. */
export function startIcalImportWorker(): void {
  if (timer) return;
  timer = setInterval(() => void run(), TICK_MS);
  timer.unref?.();
  void run();
}
