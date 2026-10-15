/**
 * Runs the outbox (./outbox.ts) in the server process: every minute, the
 * events' missing emails are queued and what is due is sent. A run never
 * overlaps the last; a failing mail server only delays the emails.
 * Server-side only.
 */
import { runJob } from "@/lib/jobs";
import { logger } from "@/lib/logger";

import { enqueue, sendDue } from "./outbox";

const INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<void> | null = null;

/** One run now, or the one already under way. */
export function runOutbox(): Promise<void> {
  running ??= (async () => {
    try {
      await runJob("email.outbox", {}, async (log) => {
        const queued = await enqueue();
        const result = await sendDue();
        if (queued > 0 || result.sent + result.skipped + result.retried + result.failed > 0) {
          log.info({ queued, ...result }, "outbox run");
        }
      });
    } catch (err) {
      logger.error({ err }, "outbox run failed");
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Starts the minutely job; called once at server start. */
export function startOutboxWorker(): void {
  if (timer) return;
  timer = setInterval(() => void runOutbox(), INTERVAL_MS);
  timer.unref?.();
  void runOutbox();
}
