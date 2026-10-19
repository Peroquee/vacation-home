"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useApiText } from "@/i18n/use-api-text";
import { useFormat } from "@/i18n/use-format";
import { addDays, type CalendarDate, daysBetween } from "@/lib/calendar-date";
import { describePolicy } from "@/lib/cancellation/describe";
import { keptPercentOn, refundTimeline, type RefundSchedule } from "@/lib/cancellation/policy";

type Values = {
  enabled: boolean;
  free: string;
  ramp: string;
  start: string;
  end: string;
};

const FIELD_NAMES = new Set([
  "freeMonthsBefore",
  "rampMonths",
  "startPercent",
  "endPercent",
  "schedule",
]);

const asNumber = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : null);

/**
 * When a cancelling guest's deposit is kept, and how much (GitLab #123), on
 * the property's Prices page: free until some months before arrival, then
 * a share rising day by day. A live example shows it for a sample arrival,
 * worded as guests will read it.
 */
export function RefundScheduleCard({
  propertyId,
  depositNonRefundable,
  schedule,
  today,
}: {
  propertyId: string;
  /** Off: nothing is kept anyway (Settings -> Payment terms). */
  depositNonRefundable: boolean;
  schedule: RefundSchedule | null;
  today: CalendarDate;
}) {
  const t = useTranslations("settings.refundSchedule");
  const tCancellation = useTranslations("cancellation");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const format = useFormat();
  const router = useRouter();
  const initial = (): Values => ({
    enabled: schedule !== null,
    free: schedule?.freeMonthsBefore != null ? String(schedule.freeMonthsBefore) : "6",
    ramp: String(schedule?.rampMonths ?? 5),
    start: String(schedule?.startPercent ?? 20),
    end: String(schedule?.endPercent ?? 100),
  });
  const [values, setValues] = useState(initial);
  const [arrival, setArrival] = useState(addDays(today, 365));
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const set = (key: keyof Values, value: string | boolean) =>
    setValues((current) => ({ ...current, [key]: value }));

  // The schedule as typed, when it makes one.
  const free = values.free.trim() === "" ? null : asNumber(values.free);
  const typed: RefundSchedule | null =
    values.enabled &&
    (values.free.trim() === "" || free !== null) &&
    asNumber(values.ramp) !== null &&
    asNumber(values.start) !== null &&
    asNumber(values.end) !== null
      ? {
          freeMonthsBefore: free,
          rampMonths: asNumber(values.ramp)!,
          startPercent: asNumber(values.start)!,
          endPercent: asNumber(values.end)!,
        }
      : null;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const body = values.enabled
        ? {
            schedule: {
              freeMonthsBefore:
                values.free.trim() === "" ? null : (asNumber(values.free) ?? values.free),
              rampMonths: asNumber(values.ramp) ?? values.ramp,
              startPercent: asNumber(values.start) ?? values.start,
              endPercent: asNumber(values.end) ?? values.end,
            },
          }
        : { schedule: null };
      const response = await fetch(`/api/properties/${propertyId}/refund-schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        const fields = json?.error?.fields as Record<string, string[]> | undefined;
        if (response.status === 422 && fields) {
          setErrors(
            Object.entries(api.fields(fields)).flatMap(([key, messages]) =>
              (messages ?? []).map((m) => {
                // "schedule.rampMonths" -> its label; the form-level "_" stands alone.
                const name = key.split(".").pop()!;
                return FIELD_NAMES.has(name) ? `${t(`fieldNames.${name}` as never)} ${m}` : m;
              }),
            ),
          );
          return;
        }
        throw new Error(
          api.message(json) ?? tCommon("serverAnswered", { status: response.status }),
        );
      }
      setErrors([]);
      toastSuccess(t("saved"));
      router.refresh();
    } catch (error) {
      toastError(error, t("saveFailed"));
    } finally {
      setPending(false);
    }
  }

  const number = (key: keyof Values, label: string, hint?: string) => (
    <Field className="max-w-48">
      <FieldLabel htmlFor={`refund-${propertyId}-${key}`}>{label}</FieldLabel>
      <Input
        id={`refund-${propertyId}-${key}`}
        inputMode="numeric"
        value={values[key] as string}
        onChange={(event) => set(key, event.target.value)}
      />
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  );

  const example = (() => {
    if (!typed) return null;
    const terms = { depositNonRefundable: true, schedule: typed, depositAmountMinor: 0 };
    const timeline = refundTimeline(typed, arrival);
    const days = [
      timeline.freeUntil,
      timeline.ramp?.from,
      // The ramp's middle day.
      timeline.ramp &&
        addDays(
          timeline.ramp.from,
          Math.floor(daysBetween(timeline.ramp.from, timeline.ramp.until) / 2),
        ),
      timeline.ramp?.until,
      addDays(arrival, -1),
    ].filter((d): d is string => Boolean(d));
    return {
      sentence: describePolicy(
        (key, v) => tCancellation(key as Parameters<typeof tCancellation>[0], v),
        (date) => format.date(date, { style: "long" }),
        { depositNonRefundable: true, schedule: typed },
        t("exampleDeposit"),
        arrival,
      ),
      rows: [...new Set(days)].map((day) => ({
        day,
        percent: Math.round(keptPercentOn(terms, arrival, day) * 10) / 10,
      })),
    };
  })();

  return (
    <Card id="refund-schedule">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {!depositNonRefundable ? (
          <p className="text-muted-foreground mb-4 text-sm">{t("refundable")}</p>
        ) : null}
        <form onSubmit={save} noValidate className="space-y-4">
          <Field orientation="horizontal">
            <Checkbox
              id={`refund-${propertyId}-enabled`}
              checked={values.enabled}
              onCheckedChange={(checked) => set("enabled", checked)}
            />
            <FieldLabel htmlFor={`refund-${propertyId}-enabled`} className="font-normal">
              {t("enabled")}
            </FieldLabel>
          </Field>
          {values.enabled ? (
            <>
              <div className="flex flex-wrap gap-4">
                {number("free", t("free"), t("freeHint"))}
                {number("ramp", t("ramp"), t("rampHint"))}
                {number("start", t("start"))}
                {number("end", t("end"))}
              </div>
              <div className="bg-muted/50 space-y-2 rounded-lg p-3 text-sm" aria-live="polite">
                <Field className="max-w-48">
                  <FieldLabel htmlFor={`refund-${propertyId}-arrival`}>
                    {t("exampleArrival")}
                  </FieldLabel>
                  <Input
                    id={`refund-${propertyId}-arrival`}
                    type="date"
                    value={arrival}
                    onChange={(event) => event.target.value && setArrival(event.target.value)}
                  />
                </Field>
                {example ? (
                  <>
                    <p>{example.sentence}</p>
                    <ul className="text-muted-foreground space-y-0.5">
                      {example.rows.map((row) => (
                        <li key={row.day}>
                          {t("exampleRow", {
                            date: format.date(row.day, { style: "long" }),
                            percent: row.percent,
                          })}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-muted-foreground">{t("exampleNone")}</p>
                )}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">{t("none")}</p>
          )}
          <FieldError errors={errors.map((message) => ({ message }))} />
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending ? tCommon("saving") : tCommon("save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
