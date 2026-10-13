"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toastError, toastSuccess } from "@/components/toast";
import { useConflictText } from "@/components/use-conflict-text";
import { Button } from "@/components/ui/button";
import { type Conflict } from "@/lib/bookings/form";
import type { BookingStatus } from "@/lib/bookings/values";
import { useApiText } from "@/i18n/use-api-text";

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
 * (./payments.tsx) confirms it and marks it paid. Cancelling asks first and frees
 * the dates at once; a cancelled or expired booking can be reinstated as an
 * inquiry.
 */
export function BookingActions({ id, status }: { id: string; status: Status }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<RequestError | null>(null);
  const t = useTranslations("bookings.actions");
  const tCommon = useTranslations("common");
  const text = useConflictText();
  const api = useApiText();
  const fail = (body: unknown, status: number) =>
    api.message(body) ?? tCommon("serverAnswered", { status });

  async function run(action: () => Promise<void>, done: string, failed: string) {
    setPending(true);
    setRefusal(null);
    try {
      await action();
      toastSuccess(done);
      router.refresh();
    } catch (error) {
      if (error instanceof RequestError && error.conflicts.length > 0) setRefusal(error);
      else toastError(error, failed);
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
          </>
        ) : null}
        {status === "cancelled" || status === "expired" ? (
          <Button
            variant="outline"
            disabled={pending}
            aria-busy={pending}
            onClick={() =>
              run(() => patchStatus(id, "inquiry", fail), t("reinstated"), t("reinstateFailed"))
            }
          >
            {t("reinstate")}
          </Button>
        ) : (
          <ConfirmDialog
            trigger={
              <Button variant="destructive" disabled={pending}>
                {t("cancel")}
              </Button>
            }
            title={t("cancelTitle")}
            description={t("cancelDescription")}
            confirmLabel={t("cancel")}
            cancelLabel={t("keep")}
            destructive
            onConfirm={async () => {
              await send(`/api/bookings/${id}/cancel`, fail, { method: "POST" });
              toastSuccess(t("cancelled"));
              router.refresh();
            }}
          />
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
                    {text.describe(conflict)}
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
