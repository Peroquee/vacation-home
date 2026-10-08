/**
 * Correlation ids that follow work across async boundaries: every log line
 * written inside `withLogContext` carries them, without passing a logger
 * around. A request's id is handed to the jobs it enqueues, so a failed
 * background sync can be traced back to the request that caused it.
 *
 * Server-side only.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type LogContext = {
  /** Set by src/proxy.ts on every request; echoed as `x-request-id`. */
  requestId?: string;
  job?: string;
  jobId?: string;
};

const storage = new AsyncLocalStorage<LogContext>();

/** Runs `fn` with `context` added to the current one. */
export function withLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run({ ...storage.getStore(), ...context }, fn);
}

export function getLogContext(): LogContext {
  return storage.getStore() ?? {};
}
