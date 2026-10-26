"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useApiText } from "@/i18n/use-api-text";

export type IncomeSettingsDto = { enabled: boolean; onCancel: "delete" | "zero" };

export type PropertyIncomeSettings = {
  property: { id: string; name: string };
  settings: IncomeSettingsDto;
};

/**
 * Booking income, per property (GitLab #80, #137): whether confirmed
 * bookings enter the ledger as income by themselves, and what happens to
 * those entries when a booking is cancelled.
 */
export function IncomeAutomationSection({ properties }: { properties: PropertyIncomeSettings[] }) {
  const t = useTranslations("settings.incomeAutomation");
  return (
    <Card id="income-automation">
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
                  {settings.enabled ? t(`summary.${settings.onCancel}`) : t("summary.off")}
                </div>
              </div>
              <IncomeAutomationDialog property={property} settings={settings} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function IncomeAutomationDialog({ property, settings }: PropertyIncomeSettings) {
  const t = useTranslations("settings.incomeAutomation");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(settings);
  const [pending, setPending] = useState(false);
  const prefix = `income-${property.id}`;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const response = await fetch(`/api/properties/${property.id}/income-automation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          api.message(body) ?? tCommon("serverAnswered", { status: response.status }),
        );
      }
      const { added = 0, removed = 0 } = body ?? {};
      toastSuccess(
        added > 0
          ? t("savedAdded", { count: added })
          : removed > 0
            ? t("savedRemoved", { count: removed })
            : t("saved"),
      );
      setOpen(false);
      router.refresh();
    } catch (error) {
      toastError(error, t("saveFailed"));
    } finally {
      setPending(false);
    }
  }

  // What saving will do to the ledger, said before it happens.
  const effect =
    values.enabled && !settings.enabled
      ? t("hints.switchOn")
      : !values.enabled && settings.enabled
        ? t("hints.switchOff")
        : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) setValues(settings);
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
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>
        <form id={`${prefix}-form`} onSubmit={submit} noValidate>
          <FieldGroup>
            <Field orientation="horizontal">
              <Checkbox
                id={`${prefix}-enabled`}
                checked={values.enabled}
                onCheckedChange={(checked) => setValues({ ...values, enabled: checked })}
              />
              <FieldLabel htmlFor={`${prefix}-enabled`} className="font-normal">
                {t("fields.enabled")}
              </FieldLabel>
            </Field>
            <Field data-disabled={values.enabled ? undefined : true}>
              <FieldLabel htmlFor={`${prefix}-onCancel`}>{t("fields.onCancel")}</FieldLabel>
              <NativeSelect
                id={`${prefix}-onCancel`}
                disabled={!values.enabled}
                value={values.onCancel}
                onChange={(event) =>
                  setValues({ ...values, onCancel: event.target.value as "delete" | "zero" })
                }
              >
                <NativeSelectOption value="delete">{t("onCancel.delete")}</NativeSelectOption>
                <NativeSelectOption value="zero">{t("onCancel.zero")}</NativeSelectOption>
              </NativeSelect>
              <FieldDescription>{t("hints.onCancel")}</FieldDescription>
            </Field>
            {effect ? (
              <p className="text-sm" role="status">
                {effect}
              </p>
            ) : null}
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
