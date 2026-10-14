/**
 * Runs the reservation hold job (./hold.ts) in the server process: at start
 * and every hour after, so a deadline passes within the hour after
 * midnight where the property is. A missed run (the app was down) is
 * caught up by the next. Server-side only.
 */
import { runJob } from "@/lib/jobs";
import { logger } from "@/lib/logger";

import { runHold } from "./hold";

const INTERVAL_MS = 60 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function run(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runJob("bookings.reservation-hold", {}, async (log) => {
      const result = await runHold();
      log.info(result, "reservation hold checked");
    });
  } catch (err) {
    logger.error({ err }, "reservation hold run failed");
  } finally {
    running = false;
  }
}

/** Starts the hourly job; called once at server start. */
export function startReservationHoldWorker(): void {
  if (timer) return;
  timer = setInterval(() => void run(), INTERVAL_MS);
  timer.unref?.();
  void run();
}
