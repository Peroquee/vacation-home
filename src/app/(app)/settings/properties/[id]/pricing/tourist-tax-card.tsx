"use client";

import { Plus, X } from "lucide-react";
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
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useAmountHint } from "@/i18n/use-amount-hint";
import { useApiText } from "@/i18n/use-api-text";
import { useFormat } from "@/i18n/use-format";
import { groupKey, type TouristTaxRules } from "@/lib/pricing/tourist-tax";
import { inputToMinor, minorToInput } from "@/lib/properties/form";

/**
 * A property's Kurtaxe (GitLab #120), on its pricing page: what the
 * municipality charges per person and night, collected for it and passed
 * on - not the owner's income. All of it is the owner's to set, from the
 * municipality's statute.
 */
export function TouristTaxCard({
  propertyId,
  currency,
  rules,
}: {
  propertyId: string;
  currency: string;
  rules: TouristTaxRules | null;
}) {
  const t = useTranslations("settings.touristTax");
  const format = useFormat();
  const money = (minor: number) => format.money(minor, currency);
  return (
    <Card id="tourist-tax">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-start justify-between gap-2">
        {rules ? (
          <ul className="space-y-1 text-sm">
            <li>{t("summaryAdult", { rate: money(rules.adultRateMinor) })}</li>
            {rules.childGroups.map((g) => (
              <li key={groupKey(g)}>
                {t("summaryChild", { from: g.fromAge, to: g.toAge, rate: money(g.rateMinor) })}
              </li>
            ))}
            {rules.periods.map((p) => (
              <li key={p.name}>
                {t("summaryPeriod", { name: p.name, rate: money(p.adultRateMinor) })}
              </li>
            ))}
            {rules.maxNights !== null ? (
              <li>{t("summaryMax", { nights: rules.maxNights })}</li>
            ) : null}
            <li className="text-muted-foreground">
              {t(rules.included ? "summaryIncluded" : "summaryPlus")}
            </li>
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t("none")}</p>
        )}
        <TouristTaxDialog propertyId={propertyId} currency={currency} rules={rules} />
      </CardContent>
    </Card>
  );
}

type GroupRow = { key: number; fromAge: string; toAge: string; rate: string };
type PeriodRow = {
  key: number;
  name: string;
  startDay: string;
  startMonth: string;
  endDay: string;
  endMonth: string;
  adultRate: string;
  /** By group row key. */
  childRates: Record<number, string>;
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const nextKey = (rows: { key: number }[]) => Math.max(-1, ...rows.map((r) => r.key)) + 1;

function TouristTaxDialog({
  propertyId,
  currency,
  rules,
}: {
  propertyId: string;
  currency: string;
  rules: TouristTaxRules | null;
}) {
  const t = useTranslations("settings.touristTax");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const api = useApiText();
  const amountHint = useAmountHint();
  const router = useRouter();
  const money = (minor: number) => minorToInput(minor, currency, locale);

  const initial = () => {
    const groups: GroupRow[] = (rules?.childGroups ?? []).map((g, i) => ({
      key: i,
      fromAge: String(g.fromAge),
      toAge: String(g.toAge),
      rate: money(g.rateMinor),
    }));
    const periods: PeriodRow[] = (rules?.periods ?? []).map((p, i) => ({
      key: i,
      name: p.name,
      startDay: String(p.startDay),
      startMonth: String(p.startMonth),
      endDay: String(p.endDay),
      endMonth: String(p.endMonth),
      adultRate: money(p.adultRateMinor),
      childRates: Object.fromEntries(
        groups.map((g, gi) => {
          const key = groupKey(rules!.childGroups[gi]!);
          return [g.key, key in p.childRatesMinor ? money(p.childRatesMinor[key]!) : ""];
        }),
      ),
    }));
    return {
      enabled: rules !== null,
      adultRate: rules ? money(rules.adultRateMinor) : "",
      groups,
      periods,
      maxNights: rules?.maxNights === null || !rules ? "" : String(rules.maxNights),
      included: rules?.included ?? false,
    };
  };
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const set = <K extends keyof ReturnType<typeof initial>>(
    key: K,
    value: ReturnType<typeof initial>[K],
  ) => setValues((current) => ({ ...current, [key]: value }));
  const monthName = (month: number) =>
    new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, month - 1, 1)),
    );
  const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : text);

  function body(): { rules: unknown } | string {
    if (!values.enabled) return { rules: null };
    const amount = (text: string) => inputToMinor(text, currency, locale);
    const adult = amount(values.adultRate);
    if (adult === null) return amountHint(currency);
    const groups = values.groups.map((g) => ({
      fromAge: whole(g.fromAge),
      toAge: whole(g.toAge),
      rateMinor: amount(g.rate),
    }));
    if (groups.some((g) => g.rateMinor === null)) return amountHint(currency);
    const periods = [];
    for (const p of values.periods) {
      const adultRateMinor = amount(p.adultRate);
      if (adultRateMinor === null) return amountHint(currency);
      const childRatesMinor: Record<string, number> = {};
      for (const [i, g] of values.groups.entries()) {
        const text = p.childRates[g.key]?.trim();
        if (!text) continue;
        const rate = amount(text);
        if (rate === null) return amountHint(currency);
        childRatesMinor[`${groups[i]!.fromAge}-${groups[i]!.toAge}`] = rate;
      }
      periods.push({
        name: p.name,
        startDay: whole(p.startDay),
        startMonth: Number(p.startMonth),
        endDay: whole(p.endDay),
        endMonth: Number(p.endMonth),
        adultRateMinor,
        childRatesMinor,
      });
    }
    return {
      rules: {
        adultRateMinor: adult,
        childGroups: groups,
        periods,
        maxNights: values.maxNights.trim() ? whole(values.maxNights) : null,
        included: values.included,
      },
    };
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = body();
    if (typeof payload === "string") {
      setErrors([payload]);
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/properties/${propertyId}/tourist-tax`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        const fields = json?.error?.fields as Record<string, string[]> | undefined;
        if (response.status === 422 && fields) {
          setErrors(Object.values(api.fields(fields)).flatMap((messages) => messages ?? []));
          return;
        }
        throw new Error(
          api.message(json) ?? tCommon("serverAnswered", { status: response.status }),
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

  const updateGroup = (key: number, field: keyof Omit<GroupRow, "key">, value: string) =>
    set(
      "groups",
      values.groups.map((g) => (g.key === key ? { ...g, [field]: value } : g)),
    );
  const updatePeriod = (key: number, change: Partial<PeriodRow>) =>
    set(
      "periods",
      values.periods.map((p) => (p.key === key ? { ...p, ...change } : p)),
    );
  const groupLabel = (g: GroupRow) =>
    t("childLabel", { from: g.fromAge || "?", to: g.toAge || "?" });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          setValues(initial());
          setErrors([]);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            {t("edit")}
          </Button>
        }
      />
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>
        <form id={`tourist-tax-${propertyId}`} onSubmit={submit} noValidate className="space-y-5">
          <Field orientation="horizontal">
            <Checkbox
              id={`tax-${propertyId}-enabled`}
              checked={values.enabled}
              onCheckedChange={(checked) => set("enabled", checked)}
            />
            <FieldLabel htmlFor={`tax-${propertyId}-enabled`} className="font-normal">
              {t("enabled")}
            </FieldLabel>
          </Field>
          {values.enabled ? (
            <>
              <Field>
                <FieldLabel htmlFor={`tax-${propertyId}-adult`}>
                  {t("adultRate", { currency })}
                </FieldLabel>
                <Input
                  id={`tax-${propertyId}-adult`}
                  inputMode="decimal"
                  className="w-32"
                  value={values.adultRate}
                  onChange={(event) => set("adultRate", event.target.value)}
                />
              </Field>

              <FieldSet>
                <FieldLegend variant="label">{t("childGroups")}</FieldLegend>
                <p className="text-muted-foreground text-sm">{t("childGroupsHint")}</p>
                <ul className="space-y-2">
                  {values.groups.map((g, i) => (
                    <li key={g.key} className="flex flex-wrap items-center gap-2 text-sm">
                      <span>{t("ages")}</span>
                      <Input
                        aria-label={t("fromAgeOf", { n: i + 1 })}
                        inputMode="numeric"
                        className="w-16"
                        value={g.fromAge}
                        onChange={(event) => updateGroup(g.key, "fromAge", event.target.value)}
                      />
                      <span>–</span>
                      <Input
                        aria-label={t("toAgeOf", { n: i + 1 })}
                        inputMode="numeric"
                        className="w-16"
                        value={g.toAge}
                        onChange={(event) => updateGroup(g.key, "toAge", event.target.value)}
                      />
                      <span>{t("rateLabel")}</span>
                      <Input
                        aria-label={t("childRateOf", { n: i + 1, currency })}
                        inputMode="decimal"
                        className="w-24"
                        value={g.rate}
                        onChange={(event) => updateGroup(g.key, "rate", event.target.value)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("removeGroup", { n: i + 1 })}
                        onClick={() =>
                          set(
                            "groups",
                            values.groups.filter((r) => r.key !== g.key),
                          )
                        }
                      >
                        <X aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
                {values.groups.length < 4 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      set("groups", [
                        ...values.groups,
                        { key: nextKey(values.groups), fromAge: "", toAge: "", rate: "" },
                      ])
                    }
                  >
                    <Plus data-icon="inline-start" aria-hidden />
                    {t("addGroup")}
                  </Button>
                ) : null}
              </FieldSet>

              <FieldSet>
                <FieldLegend variant="label">{t("periods")}</FieldLegend>
                <p className="text-muted-foreground text-sm">{t("periodsHint")}</p>
                <ul className="space-y-3">
                  {values.periods.map((p, i) => (
                    <li key={p.key} className="space-y-2 rounded-lg border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          aria-label={t("periodName", { n: i + 1 })}
                          placeholder={t("periodPlaceholder")}
                          className="w-40"
                          maxLength={60}
                          value={p.name}
                          onChange={(event) => updatePeriod(p.key, { name: event.target.value })}
                        />
                        <Input
                          aria-label={t("periodStartDay", { n: i + 1 })}
                          inputMode="numeric"
                          className="w-14"
                          value={p.startDay}
                          onChange={(event) =>
                            updatePeriod(p.key, { startDay: event.target.value })
                          }
                        />
                        <NativeSelect
                          aria-label={t("periodStartMonth", { n: i + 1 })}
                          value={p.startMonth}
                          onChange={(event) =>
                            updatePeriod(p.key, { startMonth: event.target.value })
                          }
                        >
                          {MONTHS.map((m) => (
                            <NativeSelectOption key={m} value={String(m)}>
                              {monthName(m)}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                        <span>–</span>
                        <Input
                          aria-label={t("periodEndDay", { n: i + 1 })}
                          inputMode="numeric"
                          className="w-14"
                          value={p.endDay}
                          onChange={(event) => updatePeriod(p.key, { endDay: event.target.value })}
                        />
                        <NativeSelect
                          aria-label={t("periodEndMonth", { n: i + 1 })}
                          value={p.endMonth}
                          onChange={(event) =>
                            updatePeriod(p.key, { endMonth: event.target.value })
                          }
                        >
                          {MONTHS.map((m) => (
                            <NativeSelectOption key={m} value={String(m)}>
                              {monthName(m)}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("removePeriod", { n: i + 1 })}
                          onClick={() =>
                            set(
                              "periods",
                              values.periods.filter((r) => r.key !== p.key),
                            )
                          }
                        >
                          <X aria-hidden />
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{t("adults")}</span>
                        <Input
                          aria-label={t("periodAdultRate", { n: i + 1, currency })}
                          inputMode="decimal"
                          className="w-24"
                          value={p.adultRate}
                          onChange={(event) =>
                            updatePeriod(p.key, { adultRate: event.target.value })
                          }
                        />
                        {values.groups.map((g) => (
                          <label key={g.key} className="flex items-center gap-1">
                            <span>{groupLabel(g)}</span>
                            <Input
                              aria-label={t("periodChildRate", { n: i + 1, group: groupLabel(g) })}
                              inputMode="decimal"
                              className="w-24"
                              placeholder={g.rate}
                              value={p.childRates[g.key] ?? ""}
                              onChange={(event) =>
                                updatePeriod(p.key, {
                                  childRates: { ...p.childRates, [g.key]: event.target.value },
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
                {values.periods.length < 4 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      set("periods", [
                        ...values.periods,
                        {
                          key: nextKey(values.periods),
                          name: "",
                          startDay: "1",
                          startMonth: "7",
                          endDay: "31",
                          endMonth: "8",
                          adultRate: values.adultRate,
                          childRates: {},
                        },
                      ])
                    }
                  >
                    <Plus data-icon="inline-start" aria-hidden />
                    {t("addPeriod")}
                  </Button>
                ) : null}
              </FieldSet>

              <Field>
                <FieldLabel htmlFor={`tax-${propertyId}-max`}>{t("maxNights")}</FieldLabel>
                <Input
                  id={`tax-${propertyId}-max`}
                  inputMode="numeric"
                  className="w-24"
                  value={values.maxNights}
                  onChange={(event) => set("maxNights", event.target.value)}
                />
                <p className="text-muted-foreground text-sm">{t("maxNightsHint")}</p>
              </Field>

              <FieldSet>
                <FieldLegend variant="label">{t("display")}</FieldLegend>
                {(["plus", "included"] as const).map((mode) => (
                  <label key={mode} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`tax-${propertyId}-display`}
                      checked={values.included === (mode === "included")}
                      onChange={() => set("included", mode === "included")}
                    />
                    {t(`display_${mode}`)}
                  </label>
                ))}
              </FieldSet>
            </>
          ) : null}
          <FieldError errors={errors.map((message) => ({ message }))} />
        </form>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            {tCommon("cancel")}
          </Button>
          <Button
            type="submit"
            form={`tourist-tax-${propertyId}`}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? tCommon("saving") : tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
