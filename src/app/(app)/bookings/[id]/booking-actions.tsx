"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { toastError, toastSuccess } from "@/components/toast";
import { conflictGuestNames, useConflictText } from "@/components/use-conflict-text";
import { Button } from "@/components/ui/button";
import { type Conflict } from "@/lib/bookings/form";
import type { BookingStatus } from "@/lib/bookings/values";
import { useApiText } from "@/i18n/use-api-text";

import { CancelDialog } from "./cancel-dialog";

type Status = BookingStatus;

/** A failed request, with the API's message and, for a 409, what is in the way. */
class RequestError extends Error {
  constructor(
    message: string,
    readonly conflicts: Conflict[] = [],
  ) {
    super(message);
  }
}

async function send(
  url: string,
  fail: (body: unknown, status: number) => string,
  init: RequestInit,
) {
  const response = await fetch(url, init);
  if (response.ok) return;
  const body = await response.json().catch(() => null);
  throw new RequestError(fail(body, response.status), body?.error?.conflicts ?? []);
}

const patchStatus = (id: string, status: Status, fail: (body: unknown, status: number) => string) =>
  send(`/api/bookings/${id}`, fail, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });

/**
 * Moves a booking between statuses. Confirming or reserving re-checks
 * availability on the server, so an inquiry whose dates were taken since is
 * refused, and the refusal says what is in the way. Reserving (GitLab #114)
 * holds the dates until the payment deadline; recording the payments
 * (./payments.tsx) confirms it and marks it paid. Cancelling (./cancel-dialog.tsx)
 * asks who cancels and what is refunded, and frees the dates at once; a
 * cancelled or expired booking can be reinstated as an inquiry, unless money
 * is still held or its dates have been taken (GitLab #135). A request from
 * the website is never confirmed by hand: it is accepted, and its payments
 * confirm it.
 */
export function BookingActions({
  id,
  status,
  fromWebsite,
  currency,
}: {
  id: string;
  status: Status;
  fromWebsite: boolean;
  currency: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<RequestError | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const t = useTranslations("bookings.actions");
  const tCommon = useTranslations("common");
  const text = useConflictText();
  const api = useApiText();
  // A refusal's own reason first ("refund it first"), not "invalid fields".
  const fail = (body: unknown, status: number) => {
    const fields = (body as { error?: { fields?: Record<string, unknown> } } | null)?.error?.fields;
    const reason =
      fields &&
      Object.values(fields)
        .flat()
        .find((m) => typeof m === "string");
    if (typeof reason === "string") {
      const text = api.text(reason);
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
    return api.message(body) ?? tCommon("serverAnswered", { status });
  };

  async function run(action: () => Promise<void>, done: string, failed: string) {
    setPending(true);
    setRefusal(null);
    try {
      await action();
      toastSuccess(done);
      router.refresh();
    } catch (error) {
      if (error instanceof RequestError && error.conflicts.length > 0) {
        setNames(await conflictGuestNames(error.conflicts));
        setRefusal(error);
      } else toastError(error, failed);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === "inquiry" ? (
          <>
            <Button
              disabled={pending}
              aria-busy={pending}
              onClick={() =>
                run(
                  () => send(`/api/bookings/${id}/reserve`, fail, { method: "POST" }),
                  t("reserved"),
                  t("reserveFailed"),
                )
              }
            >
              {t("reserve")}
            </Button>
            {fromWebsite ? null : (
              <Button
                variant="outline"
                disabled={pending}
                aria-busy={pending}
                onClick={() =>
                  run(() => patchStatus(id, "confirmed", fail), t("confirmed"), t("confirmFailed"))
                }
              >
                {t("confirm")}
              </Button>
            )}
          </>
        ) : null}
        {status === "cancelled" || status === "expired" ? (
          <Button
            variant="outline"
            disabled={pending}
            aria-busy={pending}
            onClick={() =>
              run(
                () => send(`/api/bookings/${id}/reinstate`, fail, { method: "POST" }),
                t("reinstated"),
                t("reinstateFailed"),
              )
            }
          >
            {t("reinstate")}
          </Button>
        ) : (
          <CancelDialog id={id} currency={currency} />
        )}
      </div>

      {refusal ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm"
        >
          <p className="font-medium">{t("taken")}</p>
          <ul className="mt-1 list-disc pl-5">
            {refusal.conflicts.map((conflict) => (
              <li key={`${conflict.kind}-${conflict.id}`}>
                {conflict.kind === "booking" ? (
                  <Link href={`/bookings/${conflict.id}`} className="underline">
                    {text.describe(conflict, names)}
                  </Link>
                ) : (
                  text.describe(conflict)
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1">{t("takenHint")}</p>
        </div>
      ) : null}
    </div>
  );
}
