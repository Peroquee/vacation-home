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
import type { RequestSettings } from "@/lib/booking-requests/settings";

export type PropertyRequestSettings = {
  property: { id: string; name: string };
  settings: RequestSettings;
};

/**
 * How booking requests are handled, per property (GitLab #110): how long
 * a request waits for an answer, and how long declined and expired ones are
 * kept before the guest's details are erased.
 */
export function RequestSettingsSection({ properties }: { properties: PropertyRequestSettings[] }) {
  const t = useTranslations("settings.requestSettings");
  return (
    <Card id="request-settings">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-lg border text-sm">
          {properties.map(({ property, settings }) => (
            <li key={property.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div>
                <div className="font-medium">{property.name}</div>
                <div className="text-muted-foreground">
                  {t("summary", { days: settings.expiryDays, months: settings.retentionMonths })}
                </div>
              </div>
              <RequestSettingsDialog property={property} settings={settings} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

type Key = keyof RequestSettings;

function RequestSettingsDialog({ property, settings }: PropertyRequestSettings) {
  const t = useTranslations("settings.requestSettings");
  const tForms = useTranslations("forms");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const router = useRouter();
  const initial = () => ({
    expiryDays: String(settings.expiryDays),
    retentionMonths: String(settings.retentionMonths),
  });
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, setPending] = useState(false);
  const prefix = `requests-${property.id}`;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const number = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : text);
      const response = await fetch(`/api/properties/${property.id}/request-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expiryDays: number(values.expiryDays),
          retentionMonths: number(values.retentionMonths),
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

  const field = (key: Key, hint?: string) => {
    const label = t(`fields.${key}`);
    return (
      <Field data-invalid={errors[key] ? true : undefined}>
        <FieldLabel htmlFor={`${prefix}-${key}`}>{label}</FieldLabel>
        <Input
          id={`${prefix}-${key}`}
          inputMode="numeric"
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
            {field("expiryDays")}
            {field("retentionMonths", t("hints.retentionMonths"))}
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
