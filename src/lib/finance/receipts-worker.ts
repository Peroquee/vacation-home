/**
 * The daily receipt cleanup (./receipts.ts): files no receipt points to any
 * more, left by deleted transactions or failed uploads. At start and every
 * 24 hours. Server-side only.
 */
import { runJob } from "@/lib/jobs";
import { logger } from "@/lib/logger";

import { removeOrphanFiles } from "./receipts";

const INTERVAL_MS = 24 * 60 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

async function run(): Promise<void> {
  try {
    await runJob("finance.receipt-cleanup", {}, async (log) => {
      log.info(await removeOrphanFiles(), "receipt files checked");
    });
  } catch (err) {
    logger.error({ err }, "receipt cleanup failed");
  }
}

/** Starts the daily job; called once at server start. */
export function startReceiptCleanupWorker(): void {
  if (timer) return;
  timer = setInterval(() => void run(), INTERVAL_MS);
  timer.unref?.();
  void run();
}
