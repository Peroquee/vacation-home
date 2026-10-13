"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useApiText } from "@/i18n/use-api-text";
import { useFormat } from "@/i18n/use-format";
import type { BookingStatus } from "@/lib/bookings/values";
import type { CalendarDate } from "@/lib/calendar-date";

export type Hold = {
  status: BookingStatus;
  currency: string;
  totalAmountMinor: number;
  depositAmountMinor: number;
  depositDueOn: CalendarDate;
  balanceDueOn: CalendarDate | null;
};

/**
 * What a reserved booking owes and by when (GitLab #114): the first payment
 * (deposit, or the full amount) and the balance. The deadlines can be moved
 * by hand while they are still open.
 */
export function PaymentHold({ id, hold }: { id: string; hold: Hold }) {
  const t = useTranslations("bookings.hold");
  const format = useFormat();
  const money = (minor: number) => format.money(minor, hold.currency);
  const full = hold.balanceDueOn === null;
  const depositOpen = hold.status === "reserved";
  const balanceOpen = !full && (hold.status === "reserved" || hold.status === "confirmed");

  return (
    <div className="space-y-3 text-sm">
      <dl className="divide-y">
        <div className="flex justify-between gap-4 py-1.5">
          <dt className="text-muted-foreground">{full ? t("fullAmount") : t("deposit")}</dt>
          <dd className="text-right">
            {money(hold.depositAmountMinor)} · {t("due", { date: format.date(hold.depositDueOn) })}
            {!depositOpen ? <span className="text-muted-foreground"> · {t("settled")}</span> : null}
          </dd>
        </div>
        {!full ? (
          <div className="flex justify-between gap-4 py-1.5">
            <dt className="text-muted-foreground">{t("balance")}</dt>
            <dd className="text-right">
              {money(hold.totalAmountMinor - hold.depositAmountMinor)} ·{" "}
              {t("due", { date: format.date(hold.balanceDueOn!) })}
              {hold.status === "paid" ? (
                <span className="text-muted-foreground"> · {t("settled")}</span>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>
      {hold.status === "expired" ? <p className="text-muted-foreground">{t("expired")}</p> : null}
      {depositOpen || balanceOpen ? (
        <DeadlinesDialog
          id={id}
          depositDueOn={depositOpen ? hold.depositDueOn : null}
          balanceDueOn={balanceOpen ? hold.balanceDueOn : null}
        />
      ) : null}
    </div>
  );
}

function DeadlinesDialog({
  id,
  depositDueOn,
  balanceDueOn,
}: {
  id: string;
  depositDueOn: CalendarDate | null;
  balanceDueOn: CalendarDate | null;
}) {
  const t = useTranslations("bookings.hold");
  const tCommon = useTranslations("common");
  const tForms = useTranslations("forms");
  const api = useApiText();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({
    deposit: depositDueOn ?? "",
    balance: balanceDueOn ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    try {
      const response = await fetch(`/api/bookings/${id}/deadlines`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(depositDueOn && values.deposit !== depositDueOn && { depositDueOn: values.deposit }),
          ...(balanceDueOn && values.balance !== balanceDueOn && { balanceDueOn: values.balance }),
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
      toastSuccess(t("deadlinesSaved"));
      setOpen(false);
      router.refresh();
    } catch (error) {
      toastError(error, t("deadlinesFailed"));
    } finally {
      setPending(false);
    }
  }

  const field = (key: "deposit" | "balance", name: string, label: string) => (
    <Field data-invalid={errors[name] ? true : undefined}>
      <FieldLabel htmlFor={`deadline-${key}`}>{label}</FieldLabel>
      <Input
        id={`deadline-${key}`}
        type="date"
        value={values[key]}
        onChange={(event) => setValues({ ...values, [key]: event.target.value })}
        {...(errors[name] && { "aria-invalid": true })}
      />
      <FieldError
        errors={errors[name]?.map((message) => ({
          message: tForms("fieldError", { label, message }),
        }))}
      />
    </Field>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          setValues({ deposit: depositDueOn ?? "", balance: balanceDueOn ?? "" });
          setErrors({});
        }
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            {t("changeDeadlines")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("changeDeadlines")}</DialogTitle>
          <DialogDescription>{t("changeDeadlinesHint")}</DialogDescription>
        </DialogHeader>
        <form id={`deadlines-${id}`} onSubmit={submit} noValidate>
          <FieldGroup>
            {depositDueOn ? field("deposit", "depositDueOn", t("depositDue")) : null}
            {balanceDueOn ? field("balance", "balanceDueOn", t("balanceDue")) : null}
            {errors._ ? <FieldError errors={errors._.map((message) => ({ message }))} /> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" form={`deadlines-${id}`} disabled={pending} aria-busy={pending}>
            {pending ? tCommon("saving") : tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
