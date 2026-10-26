"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { toastError, toastSuccess } from "@/components/toast";
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAmountHint } from "@/i18n/use-amount-hint";
import { useApiText } from "@/i18n/use-api-text";
import { useFormat } from "@/i18n/use-format";
import type { CalendarDate } from "@/lib/calendar-date";
import { type CancellationTerms, type GuestRefund, keptPercentOn } from "@/lib/cancellation/policy";
import { inputToMinor, minorToInput } from "@/lib/properties/form";

type Preview = {
  policy: CancellationTerms;
  checkIn: CalendarDate;
  today: CalendarDate;
  guest: GuestRefund;
  ownerRefundMinor: number;
};
type By = "guest" | "owner";

/**
 * Cancelling a booking (GitLab #116): who cancels, and what goes back. The
 * guest cancelling gets what the booking's policy gives (all but a
 * non-refundable deposit), the owner cancelling everything; either can be
 * changed. The dates are freed at once; the refund is recorded with the
 * payments once sent.
 */
export function CancelDialog({ id, currency }: { id: string; currency: string }) {
  const router = useRouter();
  const t = useTranslations("bookings.cancel");
  const tActions = useTranslations("bookings.actions");
  const tCommon = useTranslations("common");
  const tForms = useTranslations("forms");
  const api = useApiText();
  const amountHint = useAmountHint();
  const format = useFormat();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [by, setBy] = useState<By>("guest");
  const [refund, setRefund] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const money = (minor: number) => format.money(minor, currency);

  const suggested = (next: Preview, who: By) =>
    who === "guest" ? next.guest.refundMinor : next.ownerRefundMinor;

  function choose(who: By, from = preview) {
    setBy(who);
    if (from) setRefund(minorToInput(suggested(from, who), currency, locale));
  }

  async function load() {
    setPreview(null);
    setError(null);
    try {
      const response = await fetch(`/api/bookings/${id}/cancellation`);
      if (!response.ok) throw new Error(tCommon("serverAnswered", { status: response.status }));
      const next = (await response.json()) as Preview;
      setPreview(next);
      choose("guest", next);
    } catch (failure) {
      toastError(failure, t("loadFailed"));
      setOpen(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const refundMinor = inputToMinor(refund, currency, locale);
    if (refundMinor === null) {
      setError(amountHint(currency));
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/bookings/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ by, refundMinor }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const field = body?.error?.fields?.refundMinor?.[0];
        if (response.status === 422 && field) {
          setError(api.text(field));
          return;
        }
        throw new Error(
          api.message(body) ?? tCommon("serverAnswered", { status: response.status }),
        );
      }
      toastSuccess(tActions("cancelled"));
      setOpen(false);
      router.refresh();
    } catch (failure) {
      toastError(failure, t("failed"));
    } finally {
      setPending(false);
    }
  }

  const label = t("refund", { currency });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) void load();
      }}
    >
      <DialogTrigger render={<Button variant="destructive">{tActions("cancel")}</Button>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tActions("cancelTitle")}</DialogTitle>
          <DialogDescription>{tActions("cancelDescription")}</DialogDescription>
        </DialogHeader>
        {preview ? (
          <form id={`cancel-${id}`} onSubmit={submit} noValidate>
            <FieldGroup>
              <FieldSet>
                <FieldLegend variant="label">{t("who")}</FieldLegend>
                <div className="flex flex-wrap gap-4">
                  {(["guest", "owner"] as const).map((who) => (
                    <label key={who} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`cancel-${id}-by`}
                        checked={by === who}
                        onChange={() => choose(who)}
                      />
                      {t(`by.${who}`)}
                    </label>
                  ))}
                </div>
              </FieldSet>
              <p className="text-sm">
                {t("received", { amount: money(preview.guest.receivedMinor) })}{" "}
                {by === "owner"
                  ? t("ownerRule")
                  : !preview.policy.depositNonRefundable
                    ? t("guestRuleRefundable")
                    : preview.policy.schedule
                      ? // Where today stands on the schedule (GitLab #123).
                        t("guestRuleToday", {
                          date: format.date(preview.today, { style: "long" }),
                          percent:
                            Math.round(
                              keptPercentOn(preview.policy, preview.checkIn, preview.today) * 10,
                            ) / 10,
                          kept: money(preview.guest.retainedMinor),
                        })
                      : t("guestRule", { deposit: money(preview.policy.depositAmountMinor) })}
              </p>
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor={`cancel-${id}-refund`}>{label}</FieldLabel>
                <Input
                  id={`cancel-${id}-refund`}
                  inputMode="decimal"
                  value={refund}
                  onChange={(event) => setRefund(event.target.value)}
                  {...(error && { "aria-invalid": true })}
                />
                <FieldDescription>{t("refundHint")}</FieldDescription>
                <FieldError
                  errors={
                    error ? [{ message: tForms("fieldError", { label, message: error }) }] : []
                  }
                />
              </Field>
            </FieldGroup>
          </form>
        ) : (
          <p className="text-muted-foreground text-sm">{t("loading")}</p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            {tActions("keep")}
          </Button>
          <Button
            type="submit"
            form={`cancel-${id}`}
            variant="destructive"
            disabled={pending || !preview}
            aria-busy={pending}
          >
            {tActions("cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
