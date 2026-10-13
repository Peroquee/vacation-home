"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useAmountHint } from "@/i18n/use-amount-hint";
import { useApiText } from "@/i18n/use-api-text";
import { useFormat } from "@/i18n/use-format";
import { PAYMENT_KINDS, PAYMENT_METHODS } from "@/lib/payments/values";
import type { NextDue, PaymentDto } from "@/lib/payments/service";
import type { CalendarDate } from "@/lib/calendar-date";
import { inputToMinor, minorToInput } from "@/lib/properties/form";

type Props = {
  id: string;
  currency: string;
  totalAmountMinor: number;
  payments: PaymentDto[];
  received: number;
  next: NextDue | null;
  /** Today in the property's timezone: the default day a payment arrived. */
  today: CalendarDate;
};

/**
 * The money on a booking (GitLab #115): what has arrived, what is due next,
 * and recording a payment or refund as it happens. A payment that brings in
 * the first amount due confirms a reservation; the whole total marks the
 * booking paid. Less than that is shown as received, and moves nothing.
 */
export function Payments({
  id,
  currency,
  totalAmountMinor,
  payments,
  received,
  next,
  today,
}: Props) {
  const t = useTranslations("bookings.payments");
  const format = useFormat();
  const router = useRouter();
  const api = useApiText();
  const tCommon = useTranslations("common");
  const money = (minor: number) => format.money(minor, currency);
  const fail = (body: unknown, status: number) =>
    api.message(body) ?? tCommon("serverAnswered", { status });

  async function remove(payment: PaymentDto) {
    const response = await fetch(`/api/bookings/${id}/payments/${payment.id}`, {
      method: "DELETE",
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(fail(await response.json().catch(() => null), response.status));
    }
    toastSuccess(t("deleted"));
    router.refresh();
  }

  return (
    <div className="space-y-3 text-sm">
      <p>
        {t("received", { received: money(received), total: money(totalAmountMinor) })}
        {next && next.amountMinor > 0 ? (
          <>
            {" · "}
            {t(`next.${next.kind}`, {
              amount: money(next.amountMinor),
              date: format.date(next.dueOn),
            })}
          </>
        ) : null}
      </p>
      {payments.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {payments.map((payment) => (
            <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
              <div>
                <div>
                  {format.date(payment.receivedOn)} · {t(`kind.${payment.kind}`)} ·{" "}
                  {t(`method.${payment.method}`)}
                </div>
                {payment.note ? <div className="text-muted-foreground">{payment.note}</div> : null}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium tabular-nums">
                  {payment.kind === "refund" ? "−" : ""}
                  {money(payment.amountMinor)}
                </span>
                <ConfirmDialog
                  trigger={
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("deleteLabel", { amount: money(payment.amountMinor) })}
                    >
                      {tCommon("delete")}
                    </Button>
                  }
                  title={t("deleteTitle")}
                  description={t("deleteDescription")}
                  confirmLabel={tCommon("delete")}
                  destructive
                  onConfirm={() => remove(payment)}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <RecordPayment id={id} currency={currency} next={next} today={today} />
        <GuestLink id={id} />
      </div>
    </div>
  );
}

function RecordPayment({
  id,
  currency,
  next,
  today,
}: Pick<Props, "id" | "currency" | "next" | "today">) {
  const t = useTranslations("bookings.payments");
  const tForms = useTranslations("forms");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const amountHint = useAmountHint();
  const router = useRouter();
  const initial = () => ({
    kind: (next?.kind ?? "other") as (typeof PAYMENT_KINDS)[number],
    method: "bank_transfer" as (typeof PAYMENT_METHODS)[number],
    amount: next && next.amountMinor > 0 ? minorToInput(next.amountMinor, currency) : "",
    receivedOn: today,
    note: "",
  });
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountMinor = inputToMinor(values.amount, currency);
    if (amountMinor === null) {
      setErrors({ amountMinor: [amountHint(currency)] });
      return;
    }
    setPending(true);
    setErrors({});
    try {
      const response = await fetch(`/api/bookings/${id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: values.kind,
          method: values.method,
          amountMinor,
          receivedOn: values.receivedOn,
          note: values.note,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (response.status === 422 && body?.error?.fields) {
          setErrors(api.fields(body.error.fields));
          return;
        }
        throw new Error(
          api.message(body) ?? tCommon("serverAnswered", { status: response.status }),
        );
      }
      toastSuccess(values.kind === "refund" ? t("refundRecorded") : t("recorded"));
      setOpen(false);
      router.refresh();
    } catch (error) {
      toastError(error, t("recordFailed"));
    } finally {
      setPending(false);
    }
  }

  const messages = (key: string, label: string) =>
    errors[key]?.map((message) => ({ message: tForms("fieldError", { label, message }) }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          setValues(initial());
          setErrors({});
        }
        setOpen(next);
      }}
    >
      <DialogTrigger render={<Button size="sm">{t("record")}</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("record")}</DialogTitle>
          <DialogDescription>{t("recordHint")}</DialogDescription>
        </DialogHeader>
        <form id={`payment-${id}`} onSubmit={submit} noValidate>
          <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`payment-${id}-kind`}>{t("fields.kind")}</FieldLabel>
                <NativeSelect
                  id={`payment-${id}-kind`}
                  className="w-full"
                  value={values.kind}
                  onChange={(event) =>
                    setValues({ ...values, kind: event.target.value as typeof values.kind })
                  }
                >
                  {PAYMENT_KINDS.map((kind) => (
                    <NativeSelectOption key={kind} value={kind}>
                      {t(`kind.${kind}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field data-invalid={errors.amountMinor ? true : undefined}>
                <FieldLabel htmlFor={`payment-${id}-amount`}>
                  {t("fields.amount", { currency })}
                </FieldLabel>
                <Input
                  id={`payment-${id}-amount`}
                  inputMode="decimal"
                  value={values.amount}
                  onChange={(event) => setValues({ ...values, amount: event.target.value })}
                  {...(errors.amountMinor && { "aria-invalid": true })}
                />
                <FieldError errors={messages("amountMinor", t("fields.amount", { currency }))} />
              </Field>
              <Field data-invalid={errors.receivedOn ? true : undefined}>
                <FieldLabel htmlFor={`payment-${id}-date`}>{t("fields.receivedOn")}</FieldLabel>
                <Input
                  id={`payment-${id}-date`}
                  type="date"
                  value={values.receivedOn}
                  onChange={(event) => setValues({ ...values, receivedOn: event.target.value })}
                  {...(errors.receivedOn && { "aria-invalid": true })}
                />
                <FieldError errors={messages("receivedOn", t("fields.receivedOn"))} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`payment-${id}-method`}>{t("fields.method")}</FieldLabel>
                <NativeSelect
                  id={`payment-${id}-method`}
                  className="w-full"
                  value={values.method}
                  onChange={(event) =>
                    setValues({ ...values, method: event.target.value as typeof values.method })
                  }
                >
                  {PAYMENT_METHODS.map((method) => (
                    <NativeSelectOption key={method} value={method}>
                      {t(`method.${method}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Field data-invalid={errors.note ? true : undefined}>
              <FieldLabel htmlFor={`payment-${id}-note`}>{t("fields.note")}</FieldLabel>
              <Input
                id={`payment-${id}-note`}
                maxLength={500}
                value={values.note}
                onChange={(event) => setValues({ ...values, note: event.target.value })}
              />
              <FieldDescription>{t("noteHint")}</FieldDescription>
              <FieldError errors={messages("note", t("fields.note"))} />
            </Field>
            {Object.entries(errors)
              .filter(([key]) => !["amountMinor", "receivedOn", "note"].includes(key))
              .map(([key, list]) => (
                <FieldError key={key} errors={list?.map((message) => ({ message }))} />
              ))}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" form={`payment-${id}`} disabled={pending} aria-busy={pending}>
            {pending ? tCommon("saving") : t("record")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A new link for the guest to see their booking and how to pay, shown once to pass on. */
function GuestLink({ id }: { id: string }) {
  const t = useTranslations("bookings.payments");
  const api = useApiText();
  const tCommon = useTranslations("common");
  const [url, setUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function make() {
    setPending(true);
    try {
      const response = await fetch(`/api/bookings/${id}/guest-link`, { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          api.message(body) ?? tCommon("serverAnswered", { status: response.status }),
        );
      }
      setUrl(body.url);
    } catch (error) {
      toastError(error, t("linkFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={url !== null} onOpenChange={(open) => !open && setUrl(null)}>
      <Button size="sm" variant="outline" disabled={pending} aria-busy={pending} onClick={make}>
        {t("guestLink")}
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("guestLink")}</DialogTitle>
          <DialogDescription>{t("guestLinkHint")}</DialogDescription>
        </DialogHeader>
        <Input
          readOnly
          value={url ?? ""}
          aria-label={t("guestLink")}
          onFocus={(e) => e.target.select()}
        />
        <DialogFooter>
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url ?? "");
                toastSuccess(t("copied"));
              } catch {
                toastError(new Error(t("copyFailed")), t("copyFailed"));
              }
            }}
          >
            {t("copy")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
