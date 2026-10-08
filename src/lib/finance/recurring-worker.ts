/**
 * Runs the recurring-expense job (./recurring.ts) in the server process: at
 * start and every hour after, so a period falls due within the hour after
 * midnight where the property is. A missed run (the app was down) is caught
 * up by the next. Server-side only.
 */
import { runJob } from "@/lib/jobs";
import { logger } from "@/lib/logger";

import { materializeAll } from "./recurring";

const INTERVAL_MS = 60 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function run(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runJob("finance.recurring-expenses", {}, async (log) => {
      const result = await materializeAll();
      log.info(result, "recurring expenses materialised");
    });
  } catch (err) {
    logger.error({ err }, "recurring expense run failed");
  } finally {
    running = false;
  }
}

/** Starts the hourly job; called once at server start. */
export function startRecurringExpenseWorker(): void {
  if (timer) return;
  timer = setInterval(() => void run(), INTERVAL_MS);
  timer.unref?.();
  void run();
}
