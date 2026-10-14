"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { toastError, toastSuccess } from "@/components/toast";
import { conflictGuestNames, useConflictText } from "@/components/use-conflict-text";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useApiText } from "@/i18n/use-api-text";
import type { Conflict } from "@/lib/bookings/form";

/**
 * Accept (reserve the dates until the first payment is due) or decline a
 * request, with an optional reason for the guest. Accepting re-checks the
 * dates: taken meanwhile, it is refused and shows what is in the way.
 */
export function RequestActions({ id, name }: { id: string; name: string }) {
  const t = useTranslations("bookings.requests");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const text = useConflictText();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  async function post(path: string, body?: unknown): Promise<boolean> {
    const response = await fetch(`/api/bookings/${id}/${path}`, {
      method: "POST",
      ...(body !== undefined && {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
    if (response.ok) return true;
    const data = await response.json().catch(() => null);
    if (response.status === 409 && data?.error?.conflicts) {
      setNames(await conflictGuestNames(data.error.conflicts));
      setConflicts(data.error.conflicts);
      return false;
    }
    throw new Error(api.message(data) ?? tCommon("serverAnswered", { status: response.status }));
  }

  async function accept() {
    setPending(true);
    setConflicts([]);
    try {
      if (await post("reserve")) {
        toastSuccess(t("accepted", { name }));
        router.refresh();
      }
    } catch (error) {
      toastError(error, t("acceptFailed"));
    } finally {
      setPending(false);
    }
  }

  async function decline() {
    setPending(true);
    try {
      await post("decline", { reason });
      toastSuccess(t("declined", { name }));
      setOpen(false);
      router.refresh();
    } catch (error) {
      toastError(error, t("declineFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} aria-busy={pending} onClick={accept}>
          {t("accept")}
        </Button>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (pending) return;
            if (next) setReason("");
            setOpen(next);
          }}
        >
          <DialogTrigger
            render={
              <Button variant="outline" disabled={pending}>
                {t("decline")}
              </Button>
            }
          />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("declineTitle", { name })}</DialogTitle>
              <DialogDescription>{t("declineDescription")}</DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor={`decline-reason-${id}`}>{t("reason")}</FieldLabel>
              <Textarea
                id={`decline-reason-${id}`}
                rows={3}
                maxLength={1000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <FieldDescription>{t("reasonHint")}</FieldDescription>
            </Field>
            <DialogFooter>
              <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                {tCommon("cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={pending}
                aria-busy={pending}
                onClick={decline}
              >
                {t("decline")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {conflicts.length > 0 ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border p-3"
        >
          <p className="font-medium">{t("taken")}</p>
          <ul className="mt-1 list-disc pl-5">
            {conflicts.map((conflict) => (
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
        </div>
      ) : null}
    </div>
  );
}
