"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { useFormat } from "@/i18n/use-format";

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

async function retry(linkId: string | undefined, unexpected: (status: number) => string) {
  const response = await fetch("/api/calendar-sync/retry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(linkId ? { linkId } : {}),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? unexpected(response.status));
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
  const t = useTranslations("settings.syncFailures");
  const tCommon = useTranslations("common");
  const format = useFormat();
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
      const queued = await retry(linkId, (status) => tCommon("serverAnswered", { status }));
      toastSuccess(t("retried", { count: queued }), t("retriedHint"));
      await fetchFailures();
      router.refresh();
    } catch (error) {
      toastError(error, t("retryFailed"));
    } finally {
      setBusy(null);
    }
  }

  if (failed) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {t("loadFailed")}
      </p>
    );
  }
  if (failures === null) return <p className="text-muted-foreground text-sm">{t("checking")}</p>;
  if (failures.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("none")}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("count", { count: failures.length })}</p>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run()}>
          {busy === "all" ? t("retrying") : t("retryAll")}
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
                    {format.dateRange(failure.booking.checkIn, failure.booking.checkOut)}
                  </Link>
                ) : (
                  t("deletedBooking")
                )}
              </p>
              <p>{failure.error ?? t("genericError")}</p>
              <p className="text-muted-foreground text-xs">
                {failure.state === "dead"
                  ? t("dead", { count: failure.attempts })
                  : failure.state === "delete_failing"
                    ? t("deleteFailing")
                    : t("attempts", { count: failure.attempts })}
                {failure.failingSince
                  ? t("failingSince", { time: format.dateTime(failure.failingSince, "UTC") })
                  : ""}
                {failure.nextAttemptAt
                  ? t("nextTry", { time: format.dateTime(failure.nextAttemptAt, "UTC") })
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
              {busy === failure.linkId ? t("retrying") : t("retry")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
