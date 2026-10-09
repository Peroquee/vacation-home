"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { formatDateRange, formatDateTime } from "@/lib/format";

export type SyncFailure = {
  linkId: string;
  state: "failed" | "dead" | "delete_failing";
  /** A fixed sentence from the server; holds no guest data. */
  error: string | null;
  attempts: number;
  failingSince: string | null;
  /** Null for a dead letter: only a manual retry tries again. */
  nextAttemptAt: string | null;
  booking: {
    id: string;
    checkIn: string;
    checkOut: string;
    property: { id: string; name: string };
  } | null;
};

async function retry(linkId?: string): Promise<number> {
  const response = await fetch("/api/calendar-sync/retry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(linkId ? { linkId } : {}),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(body?.error?.message ?? `The server answered ${response.status}.`);
  return body.queued as number;
}

/**
 * The bookings whose events could not be written to Google: why, how often
 * it was tried, and when it tries again, with a retry for one or all. A
 * dead letter (given up after repeated failures) only moves again when
 * retried here or when its booking changes.
 */
export function SyncFailures() {
  const router = useRouter();
  const [failures, setFailures] = useState<SyncFailure[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  /** The failures list from the server; state is only set when it answers. */
  const fetchFailures = useCallback(
    (signal?: AbortSignal) =>
      fetch("/api/calendar-sync/failures", { signal })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error())))
        .then((list: SyncFailure[]) => {
          setFailures(list);
          setFailed(false);
        })
        .catch(() => {
          if (!signal?.aborted) setFailed(true);
        }),
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchFailures(controller.signal);
    return () => controller.abort();
  }, [fetchFailures]);

  async function run(linkId?: string) {
    setBusy(linkId ?? "all");
    try {
      const queued = await retry(linkId);
      toastSuccess(
        queued === 1 ? "Retrying 1 event" : `Retrying ${queued} events`,
        "The result shows here in a moment.",
      );
      await fetchFailures();
      router.refresh();
    } catch (error) {
      toastError(error, "Could not retry");
    } finally {
      setBusy(null);
    }
  }

  if (failed) {
    return (
      <p role="alert" className="text-destructive text-sm">
        Sync problems could not be loaded.
      </p>
    );
  }
  if (failures === null)
    return <p className="text-muted-foreground text-sm">Checking for sync problems…</p>;
  if (failures.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No sync problems: every booking is up to date in Google.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {failures.length} {failures.length === 1 ? "booking" : "bookings"} could not be synced
        </p>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run()}>
          {busy === "all" ? "Retrying…" : "Retry all"}
        </Button>
      </div>
      <ul className="divide-y rounded-lg border text-sm">
        {failures.map((failure) => (
          <li key={failure.linkId} className="flex flex-wrap items-start justify-between gap-3 p-3">
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium">
                {failure.booking ? (
                  <Link href={`/bookings/${failure.booking.id}`} className="underline">
                    {failure.booking.property.name},{" "}
                    {formatDateRange(failure.booking.checkIn, failure.booking.checkOut)}
                  </Link>
                ) : (
                  "A deleted booking's event"
                )}
              </p>
              <p>{failure.error ?? "Syncing this event failed."}</p>
              <p className="text-muted-foreground text-xs">
                {failure.state === "dead"
                  ? `Stopped after ${failure.attempts} attempts; retry by hand.`
                  : failure.state === "delete_failing"
                    ? "Removing the event from Google keeps failing."
                    : `${failure.attempts} ${failure.attempts === 1 ? "attempt" : "attempts"} so far`}
                {failure.failingSince
                  ? ` · failing since ${formatDateTime(failure.failingSince, "UTC")} (UTC)`
                  : ""}
                {failure.nextAttemptAt
                  ? ` · next try ${formatDateTime(failure.nextAttemptAt, "UTC")} (UTC)`
                  : ""}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              aria-busy={busy === failure.linkId}
              onClick={() => run(failure.linkId)}
            >
              {busy === failure.linkId ? "Retrying…" : "Retry"}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
