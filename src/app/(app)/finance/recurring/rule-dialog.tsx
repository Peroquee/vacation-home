"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useAmountHint } from "@/i18n/use-amount-hint";
import { useApiText } from "@/i18n/use-api-text";
import { inputToMinor, minorToInput } from "@/lib/properties/form";

import { ReceiptsSection } from "../receipts-section";
import type { Rule, RuleCategory, RulePrefill, RuleProperty } from "./recurring-view";
import { RulePayments } from "./rule-payments";

type FieldErrors = Record<string, string[] | undefined>;
const INTERVALS = ["monthly", "quarterly", "annual"] as const;

/**
 * Adds a recurring cost, or edits one (GitLab #104). Property, interval and
 * start are fixed once the rule exists: its past transactions were made
 * from them. Everything else applies to the transactions made from now on.
 */
export function RuleDialog({
  today,
  rule,
  prefill,
  properties,
  categories,
  onClose,
}: {
  /** Where the owner is, from the server (GitLab #139): a new rule starts on it. */
  today: string;
  rule?: Rule;
  prefill: RulePrefill | null;
  properties: RuleProperty[];
  categories: RuleCategory[];
  onClose: () => void;
}) {
  const t = useTranslations("finance.recurring");
  const tForms = useTranslations("forms");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const amountHint = useAmountHint();
  const router = useRouter();
  const locale = useLocale();
  const id = useId();
  const active = properties.filter((p) => !p.archived);
  const start = rule ?? prefill;
  const firstProperty = active.length === 1 ? active[0]!.id : "";
  const [values, setValues] = useState({
    propertyId: start?.propertyId ?? firstProperty,
    // A prefill's category only if it is offered (GitLab #129): a visible
    // expense category, never one the select cannot show.
    categoryId:
      rule?.category.id ??
      (prefill && categories.some((c) => c.id === prefill.categoryId) ? prefill.categoryId : ""),
    amount: "",
    interval: (rule?.interval ?? "monthly") as (typeof INTERVALS)[number],
    startDate: rule?.startDate ?? prefill?.startDate ?? today,
    endDate: rule?.endDate ?? "",
    description: rule?.description ?? prefill?.description ?? "",
  });
  const currency =
    properties.find((p) => p.id === values.propertyId)?.currency ?? rule?.currency ?? "EUR";
  // The amount needs the property's currency to be shown; set it once known.
  const [amountTouched, setAmountTouched] = useState(false);
  const amountMinor = rule?.amountMinor ?? prefill?.amountMinor;
  const amount =
    amountTouched || amountMinor === undefined
      ? values.amount
      : minorToInput(amountMinor, currency, locale);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  // A rule keeps its category even if that category is hidden since.
  const categoryOptions =
    rule && !categories.some((c) => c.id === rule.category.id)
      ? [{ id: rule.category.id, name: rule.category.name }, ...categories]
      : categories;

  function set<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const local: FieldErrors = {};
    const minor = inputToMinor(amount, currency, locale);
    if (!values.propertyId) local.propertyId = [tForms("required")];
    if (!values.categoryId) local.categoryId = [tForms("required")];
    if (minor === null || minor === 0) {
      local.amountMinor = [minor === 0 ? tForms("required") : amountHint(currency)];
    }
    if (Object.keys(local).length > 0) return setErrors(local);

    const body = rule
      ? {
          categoryId: values.categoryId,
          amountMinor: minor,
          endDate: values.endDate || null,
          description: values.description,
        }
      : {
          propertyId: values.propertyId,
          categoryId: values.categoryId,
          amountMinor: minor,
          interval: values.interval,
          startDate: values.startDate,
          endDate: values.endDate || null,
          description: values.description,
        };
    setPending(true);
    setErrors({});
    try {
      const response = await fetch(
        rule ? `/api/recurring-expenses/${rule.id}` : "/api/recurring-expenses",
        {
          method: rule ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = await response.json().catch(() => null);
      if (response.status === 422 && result?.error?.fields) {
        setErrors(api.fields(result.error.fields));
        return;
      }
      if (!response.ok) {
        throw new Error(
          api.message(result) ?? tCommon("serverAnswered", { status: response.status }),
        );
      }
      toastSuccess(rule ? t("saved") : t("added"), rule ? t("savedHint") : undefined);
      onClose();
      router.refresh();
    } catch (error) {
      toastError(error, t("saveFailed"));
    } finally {
      setPending(false);
    }
  }

  function field(key: string, label: string, control: React.ReactNode, hint?: string) {
    const messages = errors[key];
    return (
      <Field data-invalid={messages ? true : undefined}>
        <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
        {control}
        {hint ? <FieldDescription>{hint}</FieldDescription> : null}
        <FieldError
          errors={messages?.map((message) => ({
            message: tForms("fieldError", { label, message }),
          }))}
        />
      </Field>
    );
  }
  const invalid = (key: string) => (errors[key] ? true : undefined);

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? null : onClose())}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{rule ? t("editTitle") : t("addTitle")}</DialogTitle>
            <DialogDescription>{rule ? t("editHint") : t("addHint")}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {field(
                "propertyId",
                t("fields.property"),
                <NativeSelect
                  id={`${id}-propertyId`}
                  className="w-full"
                  value={values.propertyId}
                  disabled={Boolean(rule)}
                  aria-invalid={invalid("propertyId")}
                  onChange={(event) => set("propertyId", event.target.value)}
                >
                  <NativeSelectOption value="" disabled>
                    {t("choose")}
                  </NativeSelectOption>
                  {(rule ? properties : active).map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {p.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>,
              )}
              {field(
                "categoryId",
                t("fields.category"),
                <NativeSelect
                  id={`${id}-categoryId`}
                  className="w-full"
                  value={values.categoryId}
                  aria-invalid={invalid("categoryId")}
                  onChange={(event) => set("categoryId", event.target.value)}
                >
                  <NativeSelectOption value="" disabled>
                    {t("choose")}
                  </NativeSelectOption>
                  {categoryOptions.map((c) => (
                    <NativeSelectOption key={c.id} value={c.id}>
                      {c.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>,
              )}
              {field(
                "amountMinor",
                t("fields.amount"),
                <Input
                  id={`${id}-amountMinor`}
                  inputMode="decimal"
                  autoFocus={!rule}
                  value={amount}
                  placeholder={minorToInput(0, currency, locale)}
                  aria-invalid={invalid("amountMinor")}
                  onChange={(event) => {
                    setAmountTouched(true);
                    set("amount", event.target.value);
                  }}
                />,
                tForms("inCurrency", { currency }),
              )}
              {field(
                "interval",
                t("fields.interval"),
                <NativeSelect
                  id={`${id}-interval`}
                  className="w-full"
                  value={values.interval}
                  disabled={Boolean(rule)}
                  onChange={(event) =>
                    set("interval", event.target.value as (typeof INTERVALS)[number])
                  }
                >
                  {INTERVALS.map((interval) => (
                    <NativeSelectOption key={interval} value={interval}>
                      {t(`interval.${interval}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>,
              )}
              {field(
                "startDate",
                t("fields.startDate"),
                <Input
                  id={`${id}-startDate`}
                  type="date"
                  value={values.startDate}
                  disabled={Boolean(rule)}
                  aria-invalid={invalid("startDate")}
                  onChange={(event) => set("startDate", event.target.value)}
                />,
                rule ? undefined : t("startHint"),
              )}
              {field(
                "endDate",
                t("fields.endDate"),
                <Input
                  id={`${id}-endDate`}
                  type="date"
                  value={values.endDate}
                  min={values.startDate || undefined}
                  aria-invalid={invalid("endDate")}
                  onChange={(event) => set("endDate", event.target.value)}
                />,
                t("endHint"),
              )}
            </div>
            {field(
              "description",
              t("fields.description"),
              <Input
                id={`${id}-description`}
                maxLength={500}
                value={values.description}
                placeholder={t("descriptionPlaceholder")}
                aria-invalid={invalid("description")}
                onChange={(event) => set("description", event.target.value)}
              />,
            )}
            {errors._ ? <FieldError errors={errors._.map((message) => ({ message }))} /> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? tCommon("saving") : rule ? tCommon("save") : t("addSubmit")}
            </Button>
          </DialogFooter>
        </form>
        {/* GitLab #130: the contract and statements on the rule, the invoices on each payment. */}
        {rule ? (
          <>
            <ReceiptsSection recurringExpenseId={rule.id} />
            <RulePayments ruleId={rule.id} />
          </>
        ) : (
          <p className="text-muted-foreground border-t pt-4 text-sm">{t("documents.saveFirst")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
