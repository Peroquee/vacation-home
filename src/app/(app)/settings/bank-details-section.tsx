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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useApiText } from "@/i18n/use-api-text";
import type { BankDetails } from "@/lib/payments/bank";
import { formatIban } from "@/lib/payments/iban";

export type PropertyBankDetails = {
  property: { id: string; name: string };
  details: BankDetails | null;
};

/**
 * Where guests transfer to, per property (GitLab #115): shown on the
 * guest's booking page with the amount due and the GiroCode.
 */
export function BankDetailsSection({ properties }: { properties: PropertyBankDetails[] }) {
  const t = useTranslations("settings.bankDetails");
  return (
    <Card id="bank-details">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-lg border text-sm">
          {properties.map(({ property, details }) => (
            <li key={property.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div>
                <div className="font-medium">{property.name}</div>
                <div className="text-muted-foreground">
                  {details ? `${details.accountHolder} · ${formatIban(details.iban)}` : t("none")}
                </div>
              </div>
              <BankDetailsDialog property={property} details={details} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

type Key = "accountHolder" | "iban" | "bic" | "bankName";

function BankDetailsDialog({ property, details }: PropertyBankDetails) {
  const t = useTranslations("settings.bankDetails");
  const tForms = useTranslations("forms");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const router = useRouter();
  const initial = () => ({
    accountHolder: details?.accountHolder ?? "",
    iban: details ? formatIban(details.iban) : "",
    bic: details?.bic ?? "",
    bankName: details?.bankName ?? "",
  });
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, setPending] = useState(false);
  const prefix = `bank-${property.id}`;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    try {
      const response = await fetch(`/api/properties/${property.id}/bank-details`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
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

  const field = (key: Key, hint?: string) => {
    const label = t(`fields.${key}`);
    return (
      <Field data-invalid={errors[key] ? true : undefined}>
        <FieldLabel htmlFor={`${prefix}-${key}`}>{label}</FieldLabel>
        <Input
          id={`${prefix}-${key}`}
          value={values[key]}
          onChange={(event) => setValues({ ...values, [key]: event.target.value })}
          {...(errors[key] && { "aria-invalid": true })}
        />
        {hint ? <FieldDescription>{hint}</FieldDescription> : null}
        <FieldError
          errors={errors[key]?.map((message) => ({
            message: tForms("fieldError", { label, message }),
          }))}
        />
      </Field>
    );
  };

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
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" aria-label={t("edit", { name: property.name })}>
            {tCommon("edit")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle", { name: property.name })}</DialogTitle>
        </DialogHeader>
        <form id={`${prefix}-form`} onSubmit={submit} noValidate>
          <FieldGroup>
            {field("accountHolder")}
            {field("iban")}
            {field("bic", t("hints.optional"))}
            {field("bankName", t("hints.optional"))}
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
