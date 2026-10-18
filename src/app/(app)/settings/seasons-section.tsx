"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useAmountHint } from "@/i18n/use-amount-hint";
import { useApiText } from "@/i18n/use-api-text";
import { useFormat } from "@/i18n/use-format";
import { addDays, type CalendarDate } from "@/lib/calendar-date";
import { type PricingRules, rateOn } from "@/lib/pricing/engine";
import { type Season, seasonOn, seasonRule } from "@/lib/pricing/seasons";
import { inputToMinor, minorToInput } from "@/lib/properties/form";

export type PropertySeasons = {
  property: {
    id: string;
    name: string;
    currency: string;
    defaultNightlyRateMinor: number;
    defaultCleaningFeeMinor: number;
  };
  seasons: Season[];
};

type FieldErrors = Record<string, string[] | undefined>;

/** Colours for the seasons in the preview strip; the default rate is plain. */
const COLOURS = ["bg-amber-400", "bg-sky-500", "bg-emerald-500", "bg-rose-400", "bg-violet-500"];

/**
 * Seasonal prices per property (GitLab #118): named periods with their own
 * nightly rate, every year or once, and a 12-month strip of which rate
 * applies when. Outside every season, the property's standard rate applies;
 * a one-off season wins over a yearly one it lies in. Bookings keep the
 * price they were given.
 */
export function SeasonsSection({
  properties,
  today,
}: {
  properties: PropertySeasons[];
  /** The first day of the preview: today, where the server is. */
  today: CalendarDate;
}) {
  const t = useTranslations("settings.seasons");
  return (
    <Card id="seasons">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {properties.map((entry) => (
          <PropertySeasonList key={entry.property.id} {...entry} today={today} />
        ))}
      </CardContent>
    </Card>
  );
}

function usePeriod() {
  const t = useTranslations("settings.seasons");
  const locale = useLocale();
  return (s: Season) => {
    const day = (month: number, d: number) =>
      new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(
        new Date(Date.UTC(2024, month - 1, d)),
      );
    const range = `${day(s.startMonth, s.startDay)} – ${day(s.endMonth, s.endDay)}`;
    return s.year === null ? t("everyYear", { range }) : t("inYear", { range, year: s.year });
  };
}

function PropertySeasonList({ property, seasons, today }: PropertySeasons & { today: string }) {
  const t = useTranslations("settings.seasons");
  const tCommon = useTranslations("common");
  const format = useFormat();
  const period = usePeriod();
  const router = useRouter();
  const money = (minor: number) => format.money(minor, property.currency);

  async function remove(season: Season) {
    const response = await fetch(`/api/properties/${property.id}/seasons/${season.id}`, {
      method: "DELETE",
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(tCommon("serverAnswered", { status: response.status }));
    }
    toastSuccess(t("deleted"));
    router.refresh();
  }

  return (
    <section aria-labelledby={`seasons-${property.id}`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`seasons-${property.id}`} className="font-medium">
          {property.name}
        </h3>
        <SeasonDialog property={property} />
      </div>
      <p className="text-muted-foreground text-sm">
        {t("standardRate", { rate: money(property.defaultNightlyRateMinor) })}
      </p>
      {seasons.length > 0 ? (
        <ul className="divide-y rounded-lg border text-sm">
          {seasons.map((season, i) => (
            <li key={season.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`size-3 shrink-0 rounded-sm ${COLOURS[i % COLOURS.length]}`}
                />
                <div>
                  <div className="font-medium">
                    {season.name} · {money(season.rateMinor)}
                  </div>
                  <div className="text-muted-foreground">{period(season)}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <SeasonDialog property={property} season={season} />
                <ConfirmDialog
                  trigger={
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={t("delete", { name: season.name })}
                    >
                      {tCommon("delete")}
                    </Button>
                  }
                  title={t("deleteTitle", { name: season.name })}
                  description={t("deleteDescription")}
                  confirmLabel={tCommon("delete")}
                  destructive
                  onConfirm={() => remove(season)}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{t("none")}</p>
      )}
      <PreviewStrip property={property} seasons={seasons} today={today} />
    </section>
  );
}

/**
 * The next 12 months, a bar each: which rate applies on which day, as the
 * engine prices it. The text beside each bar says the same for screen
 * readers and at a glance.
 */
function PreviewStrip({ property, seasons, today }: PropertySeasons & { today: string }) {
  const t = useTranslations("settings.seasons");
  const locale = useLocale();
  const format = useFormat();
  const months = useMemo(() => {
    const rules: PricingRules = {
      currency: property.currency,
      defaultNightlyRateMinor: property.defaultNightlyRateMinor,
      defaultCleaningFeeMinor: property.defaultCleaningFeeMinor,
      seasons: seasons.map(seasonRule),
    };
    const result: {
      label: string;
      days: number;
      runs: { from: number; to: number; season: Season | null; rateMinor: number }[];
    }[] = [];
    let date = `${today.slice(0, 7)}-01`;
    for (let m = 0; m < 12; m++) {
      const month = date.slice(0, 7);
      const runs: (typeof result)[number]["runs"] = [];
      let day = 1;
      for (; date.startsWith(month); date = addDays(date, 1), day++) {
        const season = seasonOn(seasons, date);
        const rateMinor = rateOn(rules, date);
        const last = runs.at(-1);
        if (last && last.season?.id === season?.id) last.to = day;
        else runs.push({ from: day, to: day, season, rateMinor });
      }
      result.push({
        label: new Intl.DateTimeFormat(locale, {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${month}-01T00:00:00Z`)),
        days: day - 1,
        runs,
      });
    }
    return result;
  }, [property, seasons, today, locale]);
  const colour = (season: Season | null) =>
    season ? COLOURS[seasons.indexOf(season) % COLOURS.length] : "bg-muted-foreground/25";

  return (
    <figure className="space-y-1">
      <figcaption className="text-muted-foreground text-xs">{t("preview")}</figcaption>
      <ul className="space-y-1 text-xs">
        {months.map((month) => (
          <li key={month.label} className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
            <span className="tabular-nums">{month.label}</span>
            <div className="space-y-0.5">
              <div aria-hidden className="flex h-2 overflow-hidden rounded-full">
                {month.runs.map((run) => (
                  <span
                    key={run.from}
                    className={colour(run.season)}
                    style={{ width: `${((run.to - run.from + 1) / month.days) * 100}%` }}
                  />
                ))}
              </div>
              <p className="text-muted-foreground">
                {month.runs
                  .map((run) =>
                    t("run", {
                      from: run.from,
                      to: run.to,
                      name: run.season?.name ?? t("standard"),
                      rate: format.money(run.rateMinor, property.currency),
                    }),
                  )
                  .join(" · ")}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function SeasonDialog({
  property,
  season,
}: {
  property: PropertySeasons["property"];
  season?: Season;
}) {
  const t = useTranslations("settings.seasons");
  const tCommon = useTranslations("common");
  const tForms = useTranslations("forms");
  const locale = useLocale();
  const api = useApiText();
  const amountHint = useAmountHint();
  const router = useRouter();
  const initial = () => ({
    name: season?.name ?? "",
    startDay: String(season?.startDay ?? 1),
    startMonth: String(season?.startMonth ?? 7),
    endDay: String(season?.endDay ?? 31),
    endMonth: String(season?.endMonth ?? 8),
    everyYear: season ? season.year === null : true,
    year: String(season?.year ?? new Date().getFullYear()),
    rate: season ? minorToInput(season.rateMinor, property.currency) : "",
  });
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const prefix = `season-${season?.id ?? `new-${property.id}`}`;
  const monthName = (month: number) =>
    new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, month - 1, 1)),
    );
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rateMinor = inputToMinor(values.rate, property.currency);
    if (rateMinor === null) {
      setErrors({ rateMinor: [amountHint(property.currency)] });
      return;
    }
    const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : text);
    setPending(true);
    try {
      const response = await fetch(
        `/api/properties/${property.id}/seasons${season ? `/${season.id}` : ""}`,
        {
          method: season ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: values.name,
            startDay: whole(values.startDay),
            startMonth: Number(values.startMonth),
            endDay: whole(values.endDay),
            endMonth: Number(values.endMonth),
            year: values.everyYear ? null : whole(values.year),
            rateMinor,
          }),
        },
      );
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

  const errorsFor = (key: string, label: string) => (
    <FieldError
      errors={errors[key]?.map((message) => ({
        message: tForms("fieldError", { label, message }),
      }))}
    />
  );

  const dayAndMonth = (end: "start" | "end") => {
    const dayKey = `${end}Day` as const;
    const monthKey = `${end}Month` as const;
    const label = t(end);
    return (
      <FieldSet data-invalid={errors[dayKey] || errors[monthKey] ? true : undefined}>
        <FieldLegend variant="label">{label}</FieldLegend>
        <div className="grid grid-cols-[5rem_1fr] gap-2">
          <Input
            id={`${prefix}-${dayKey}`}
            aria-label={t("dayOf", { which: label })}
            inputMode="numeric"
            value={values[dayKey]}
            onChange={(event) => set(dayKey, event.target.value)}
            {...(errors[dayKey] && { "aria-invalid": true })}
          />
          <NativeSelect
            id={`${prefix}-${monthKey}`}
            aria-label={t("monthOf", { which: label })}
            className="w-full"
            value={values[monthKey]}
            onChange={(event) => set(monthKey, event.target.value)}
          >
            {MONTHS.map((month) => (
              <NativeSelectOption key={month} value={String(month)}>
                {monthName(month)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        {errorsFor(dayKey, label)}
        {errorsFor(monthKey, label)}
      </FieldSet>
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
          season ? (
            <Button variant="outline" size="sm" aria-label={t("edit", { name: season.name })}>
              {tCommon("edit")}
            </Button>
          ) : (
            <Button variant="outline" size="sm" aria-label={t("addFor", { name: property.name })}>
              {t("add")}
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {season ? t("editTitle", { name: season.name }) : t("addTitle")}
          </DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>
        <form id={`${prefix}-form`} onSubmit={submit} noValidate>
          <FieldGroup>
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor={`${prefix}-name`}>{t("name")}</FieldLabel>
              <Input
                id={`${prefix}-name`}
                maxLength={60}
                value={values.name}
                onChange={(event) => set("name", event.target.value)}
                {...(errors.name && { "aria-invalid": true })}
              />
              <FieldDescription>{t("nameHint")}</FieldDescription>
              {errorsFor("name", t("name"))}
            </Field>
            {dayAndMonth("start")}
            {dayAndMonth("end")}
            <Field orientation="horizontal">
              <Checkbox
                id={`${prefix}-everyYear`}
                checked={values.everyYear}
                onCheckedChange={(checked) => set("everyYear", checked)}
              />
              <FieldLabel htmlFor={`${prefix}-everyYear`} className="font-normal">
                {t("repeats")}
              </FieldLabel>
            </Field>
            {!values.everyYear ? (
              <Field data-invalid={errors.year ? true : undefined}>
                <FieldLabel htmlFor={`${prefix}-year`}>{t("year")}</FieldLabel>
                <Input
                  id={`${prefix}-year`}
                  inputMode="numeric"
                  value={values.year}
                  onChange={(event) => set("year", event.target.value)}
                  {...(errors.year && { "aria-invalid": true })}
                />
                {errorsFor("year", t("year"))}
              </Field>
            ) : null}
            <Field data-invalid={errors.rateMinor ? true : undefined}>
              <FieldLabel htmlFor={`${prefix}-rate`}>
                {t("rate", { currency: property.currency })}
              </FieldLabel>
              <Input
                id={`${prefix}-rate`}
                inputMode="decimal"
                value={values.rate}
                onChange={(event) => set("rate", event.target.value)}
                {...(errors.rateMinor && { "aria-invalid": true })}
              />
              {errorsFor("rateMinor", t("rate", { currency: property.currency }))}
            </Field>
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
