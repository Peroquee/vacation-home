"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
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
import { useApiText } from "@/i18n/use-api-text";
import type { BookingRules } from "@/lib/booking-rules/rules";

export type PropertyRules = { property: { id: string; name: string }; rules: BookingRules };

type FieldErrors = Record<string, string[] | undefined>;

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/** "Monday" ... "Sunday" in `locale`, by ISO weekday. 2026-07-06 is a Monday. */
function weekdayName(locale: string, isoDay: number, width: "long" | "short" = "long"): string {
  return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: "UTC" }).format(
    new Date(Date.UTC(2026, 6, 5 + isoDay)),
  );
}

/**
 * Booking rules per property (GitLab #107): the limits for stays guests
 * request on the public site. The owner's own booking form shows breaking
 * them as a warning only.
 */
export function BookingRulesSection({ properties }: { properties: PropertyRules[] }) {
  const t = useTranslations("settings.bookingRules");
  const locale = useLocale();

  function summary(rules: BookingRules): string {
    const parts = [
      rules.maxNights === null
        ? t("summary.nightsFrom", { min: rules.minNights })
        : t("summary.nightsBetween", { min: rules.minNights, max: rules.maxNights }),
    ];
    if (rules.minLeadDays > 0) parts.push(t("summary.lead", { days: rules.minLeadDays }));
    if (rules.horizonDays !== null) parts.push(t("summary.horizon", { days: rules.horizonDays }));
    if (rules.checkInWeekdays.length > 0) {
      parts.push(
        t("summary.weekdays", {
          days: rules.checkInWeekdays.map((d) => weekdayName(locale, d, "short")).join(", "),
        }),
      );
    }
    if (rules.bufferDays > 0) parts.push(t("summary.buffer", { days: rules.bufferDays }));
    return parts.join(" · ");
  }

  return (
    <Card id="booking-rules">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-lg border text-sm">
          {properties.map(({ property, rules }) => (
            <li key={property.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div>
                <div className="font-medium">{property.name}</div>
                <div className="text-muted-foreground">{summary(rules)}</div>
              </div>
              <BookingRulesDialog property={property} rules={rules} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

type Values = {
  minNights: string;
  maxNights: string;
  minLeadDays: string;
  horizonDays: string;
  checkInWeekdays: number[];
  bufferDays: string;
};

function toValues(rules: BookingRules): Values {
  return {
    minNights: String(rules.minNights),
    maxNights: rules.maxNights === null ? "" : String(rules.maxNights),
    minLeadDays: String(rules.minLeadDays),
    horizonDays: rules.horizonDays === null ? "" : String(rules.horizonDays),
    checkInWeekdays: rules.checkInWeekdays,
    bufferDays: String(rules.bufferDays),
  };
}

/**
 * A whole number from the input, or null for blank. Anything else is sent as
 * typed, for the API to refuse with its message: turned into a number it
 * could become NaN, which JSON sends as null - "no limit".
 */
function toNumber(text: string): number | string | null {
  const value = text.trim();
  if (value === "") return null;
  return /^\d+$/.test(value) ? Number(value) : value;
}

function BookingRulesDialog({
  property,
  rules,
}: {
  property: { id: string; name: string };
  rules: BookingRules;
}) {
  const router = useRouter();
  const t = useTranslations("settings.bookingRules");
  const tForms = useTranslations("forms");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(() => toValues(rules));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  function openChange(next: boolean) {
    if (pending) return;
    if (next) {
      setValues(toValues(rules));
      setErrors({});
    }
    setOpen(next);
  }

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const response = await fetch(`/api/properties/${property.id}/booking-rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Blank minimums mean the least; blank limits mean none.
          minNights: toNumber(values.minNights) ?? 1,
          maxNights: toNumber(values.maxNights),
          minLeadDays: toNumber(values.minLeadDays) ?? 0,
          horizonDays: toNumber(values.horizonDays),
          checkInWeekdays: values.checkInWeekdays,
          bufferDays: toNumber(values.bufferDays) ?? 0,
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

  const prefix = `rules-${property.id}`;

  function numberField(key: Exclude<keyof Values, "checkInWeekdays">, hint?: string) {
    const label = t(`fields.${key}`);
    const messages = errors[key];
    return (
      <Field data-invalid={messages ? true : undefined}>
        <FieldLabel htmlFor={`${prefix}-${key}`}>{label}</FieldLabel>
        <Input
          id={`${prefix}-${key}`}
          inputMode="numeric"
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
    <Dialog open={open} onOpenChange={openChange}>
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
            <div className="grid gap-5 sm:grid-cols-2">
              {numberField("minNights")}
              {numberField("maxNights", t("blankForNone"))}
              {numberField("minLeadDays", t("hints.minLeadDays"))}
              {numberField("horizonDays", t("blankForNone"))}
            </div>
            {numberField("bufferDays", t("hints.bufferDays"))}
            <FieldSet data-invalid={errors.checkInWeekdays ? true : undefined}>
              <FieldLegend variant="label">{t("fields.checkInWeekdays")}</FieldLegend>
              <FieldDescription>{t("hints.checkInWeekdays")}</FieldDescription>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {WEEKDAYS.map((day) => (
                  <Field key={day} orientation="horizontal" className="w-auto">
                    <Checkbox
                      id={`${prefix}-weekday-${day}`}
                      checked={values.checkInWeekdays.includes(day)}
                      onCheckedChange={(checked) =>
                        set(
                          "checkInWeekdays",
                          checked
                            ? [...values.checkInWeekdays, day].sort((a, b) => a - b)
                            : values.checkInWeekdays.filter((d) => d !== day),
                        )
                      }
                    />
                    <FieldLabel htmlFor={`${prefix}-weekday-${day}`} className="font-normal">
                      {weekdayName(locale, day)}
                    </FieldLabel>
                  </Field>
                ))}
              </div>
              <FieldError
                errors={errors.checkInWeekdays?.map((message) => ({
                  message: tForms("fieldError", { label: t("fields.checkInWeekdays"), message }),
                }))}
              />
            </FieldSet>
            {errors._ ? <FieldError errors={errors._.map((message) => ({ message }))} /> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => openChange(false)}>
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
