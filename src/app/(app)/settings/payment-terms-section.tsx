"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useAmountHint } from "@/i18n/use-amount-hint";
import { useApiText } from "@/i18n/use-api-text";
import { useFormat } from "@/i18n/use-format";
import type { PaymentTerms } from "@/lib/payment-terms/terms";
import { inputToMinor, minorToInput } from "@/lib/properties/form";

export type PropertyTerms = {
  property: { id: string; name: string; currency: string };
  terms: PaymentTerms;
};

type FieldErrors = Record<string, string[] | undefined>;

/**
 * Payment terms per property (GitLab #114): what a guest pays once their
 * request is accepted, and by when, and whether the deposit is kept when
 * the guest cancels (GitLab #116). Accepting holds the dates until the
 * first payment's deadline; unpaid, the reservation lapses by itself.
 */
export function PaymentTermsSection({ properties }: { properties: PropertyTerms[] }) {
  const t = useTranslations("settings.paymentTerms");
  const format = useFormat();

  function summary({ property, terms }: PropertyTerms): string {
    const deposit =
      terms.depositPercent !== null
        ? t("summary.percent", { percent: terms.depositPercent, days: terms.depositDueDays })
        : t("summary.fixed", {
            amount: format.money(terms.depositFixedMinor!, property.currency),
            days: terms.depositDueDays,
          });
    return [
      deposit,
      t("summary.balance", { days: terms.balanceDueDaysBefore }),
      t("summary.full", { days: terms.fullPaymentDueDays }),
      t(terms.depositNonRefundable ? "summary.nonRefundable" : "summary.refundable"),
    ].join(" · ");
  }

  return (
    <Card id="payment-terms">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-lg border text-sm">
          {properties.map((entry) => (
            <li
              key={entry.property.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3"
            >
              <div>
                <div className="font-medium">{entry.property.name}</div>
                <div className="text-muted-foreground">{summary(entry)}</div>
              </div>
              <PaymentTermsDialog {...entry} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

type Values = {
  kind: "percent" | "fixed";
  depositPercent: string;
  depositFixed: string;
  depositDueDays: string;
  balanceDueDaysBefore: string;
  fullPaymentDueDays: string;
  depositNonRefundable: boolean;
};

function toValues(terms: PaymentTerms, currency: string): Values {
  return {
    kind: terms.depositPercent !== null ? "percent" : "fixed",
    depositPercent: String(terms.depositPercent ?? 20),
    depositFixed:
      terms.depositFixedMinor !== null ? minorToInput(terms.depositFixedMinor, currency) : "",
    depositDueDays: String(terms.depositDueDays),
    balanceDueDaysBefore: String(terms.balanceDueDaysBefore),
    fullPaymentDueDays: String(terms.fullPaymentDueDays),
    depositNonRefundable: terms.depositNonRefundable,
  };
}

/** A whole number from the input; anything else as typed, for the API to refuse. */
function toNumber(text: string): number | string {
  const value = text.trim();
  return /^\d+$/.test(value) ? Number(value) : value;
}

function PaymentTermsDialog({ property, terms }: PropertyTerms) {
  const router = useRouter();
  const t = useTranslations("settings.paymentTerms");
  const tForms = useTranslations("forms");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const amountHint = useAmountHint();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(() => toValues(terms, property.currency));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const prefix = `terms-${property.id}`;

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let fixed: number | null = null;
    if (values.kind === "fixed") {
      fixed = inputToMinor(values.depositFixed, property.currency);
      if (fixed === null) {
        setErrors({ depositFixedMinor: [amountHint(property.currency)] });
        return;
      }
    }
    setPending(true);
    try {
      const response = await fetch(`/api/properties/${property.id}/payment-terms`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          depositPercent: values.kind === "percent" ? toNumber(values.depositPercent) : null,
          depositFixedMinor: fixed,
          depositDueDays: toNumber(values.depositDueDays),
          balanceDueDaysBefore: toNumber(values.balanceDueDaysBefore),
          fullPaymentDueDays: toNumber(values.fullPaymentDueDays),
          depositNonRefundable: values.depositNonRefundable,
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
      toastSuccess(t("saved"));
      setOpen(false);
      router.refresh();
    } catch (error) {
      toastError(error, t("saveFailed"));
    } finally {
      setPending(false);
    }
  }

  function field(
    key: Exclude<keyof Values, "kind" | "depositNonRefundable">,
    name: string,
    label: string,
    hint?: string,
    inputMode: "numeric" | "decimal" = "numeric",
  ) {
    const messages = errors[name];
    return (
      <Field data-invalid={messages ? true : undefined}>
        <FieldLabel htmlFor={`${prefix}-${key}`}>{label}</FieldLabel>
        <Input
          id={`${prefix}-${key}`}
          inputMode={inputMode}
          value={values[key]}
          onChange={(event) => set(key, event.target.value)}
          {...(messages && { "aria-invalid": true })}
        />
        {hint ? <FieldDescription>{hint}</FieldDescription> : null}
        <FieldError
          errors={messages?.map((message) => ({
            message: tForms("fieldError", { label, message }),
          }))}
        />
      </Field>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          setValues(toValues(terms, property.currency));
          setErrors({});
        }
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" aria-label={t("edit", { name: property.name })}>
            {tCommon("edit")}
          </Button>
        }
      />
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle", { name: property.name })}</DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>
        <form id={`${prefix}-form`} onSubmit={submit} noValidate>
          <FieldGroup>
            <FieldSet>
              <FieldLegend variant="label">{t("fields.deposit")}</FieldLegend>
              <div className="flex gap-4">
                {(["percent", "fixed"] as const).map((kind) => (
                  <label key={kind} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`${prefix}-kind`}
                      checked={values.kind === kind}
                      onChange={() => set("kind", kind)}
                    />
                    {t(`kind.${kind}`)}
                  </label>
                ))}
              </div>
            </FieldSet>
            {values.kind === "percent"
              ? field("depositPercent", "depositPercent", t("fields.depositPercent"))
              : field(
                  "depositFixed",
                  "depositFixedMinor",
                  t("fields.depositFixed", { currency: property.currency }),
                  undefined,
                  "decimal",
                )}
            <div className="grid gap-5 sm:grid-cols-2">
              {field("depositDueDays", "depositDueDays", t("fields.depositDueDays"))}
              {field(
                "balanceDueDaysBefore",
                "balanceDueDaysBefore",
                t("fields.balanceDueDaysBefore"),
              )}
            </div>
            {field(
              "fullPaymentDueDays",
              "fullPaymentDueDays",
              t("fields.fullPaymentDueDays"),
              t("hints.fullPaymentDueDays"),
            )}
            {/* The cancellation policy (GitLab #116). */}
            <Field orientation="horizontal">
              <Checkbox
                id={`${prefix}-depositNonRefundable`}
                checked={values.depositNonRefundable}
                onCheckedChange={(checked) => set("depositNonRefundable", checked)}
              />
              <FieldLabel htmlFor={`${prefix}-depositNonRefundable`}>
                {t("fields.depositNonRefundable")}
              </FieldLabel>
            </Field>
            <FieldDescription>{t("hints.depositNonRefundable")}</FieldDescription>
            {errors._ ? <FieldError errors={errors._.map((message) => ({ message }))} /> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" form={`${prefix}-form`} disabled={pending} aria-busy={pending}>
            {pending ? tCommon("saving") : tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
