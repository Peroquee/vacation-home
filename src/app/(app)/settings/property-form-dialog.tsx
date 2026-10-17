"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
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
import {
  currencyOptions,
  inputToMinor,
  minorToInput,
  timeZoneOptions,
} from "@/lib/properties/form";
import { DEFAULT_PROPERTY_COLOR } from "@/lib/properties/values";
import type { PropertyDto } from "@/lib/properties/service";

type FieldErrors = Record<string, string[] | undefined>;

type Values = {
  name: string;
  address: string;
  timezone: string;
  currency: string;
  nightlyRate: string;
  cleaningFee: string;
  color: string;
  slug: string;
  publiclyListed: boolean;
};

function initialValues(property?: PropertyDto): Values {
  if (property) {
    return {
      name: property.name,
      address: property.address ?? "",
      timezone: property.timezone,
      currency: property.currency,
      nightlyRate: minorToInput(property.defaultNightlyRateMinor, property.currency),
      cleaningFee: minorToInput(property.defaultCleaningFeeMinor, property.currency),
      color: property.color,
      slug: property.slug ?? "",
      publiclyListed: property.publiclyListed,
    };
  }
  return {
    name: "",
    address: "",
    // The browser's own zone is the likeliest answer for a new property.
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    currency: "EUR",
    nightlyRate: "",
    cleaningFee: "",
    color: DEFAULT_PROPERTY_COLOR,
    slug: "",
    publiclyListed: false,
  };
}

/**
 * Adds a property, or edits one when `property` is given. Sends every field,
 * so a currency change always restates the defaults in the new currency, as
 * the API requires.
 */
export function PropertyFormDialog({
  property,
  trigger,
  canList = true,
}: {
  property?: PropertyDto;
  trigger: React.ReactElement;
  /** False until the legal pages are filled in (GitLab #112): listing stays off. */
  canList?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(() => initialValues(property));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const t = useTranslations("settings.propertyForm");
  const tForms = useTranslations("forms");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const amountHint = useAmountHint();
  const { locale } = useFormat();

  const timeZones = useMemo(() => {
    const zones = timeZoneOptions();
    // Keep a stored zone selectable even if this browser's list lacks it.
    return zones.includes(values.timezone) ? zones : [values.timezone, ...zones];
  }, [values.timezone]);
  const currencies = useMemo(() => currencyOptions(locale), [locale]);

  function openChange(next: boolean) {
    if (pending) return;
    if (next) {
      setValues(initialValues(property));
      setErrors({});
    }
    setOpen(next);
  }

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nightly = inputToMinor(values.nightlyRate, values.currency);
    const cleaning = inputToMinor(values.cleaningFee, values.currency);
    const amountError = amountHint(values.currency);
    if (nightly === null || cleaning === null) {
      setErrors({
        defaultNightlyRateMinor: nightly === null ? [amountError] : undefined,
        defaultCleaningFeeMinor: cleaning === null ? [amountError] : undefined,
      });
      return;
    }

    setPending(true);
    try {
      const response = await fetch(
        property ? `/api/properties/${property.id}` : "/api/properties",
        {
          method: property ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: values.name,
            address: values.address,
            timezone: values.timezone,
            currency: values.currency,
            defaultNightlyRateMinor: nightly,
            defaultCleaningFeeMinor: cleaning,
            color: values.color,
            slug: values.slug,
            publiclyListed: values.publiclyListed,
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
      toastSuccess(property ? t("saved") : t("added"));
      setOpen(false);
      router.refresh();
    } catch (error) {
      toastError(error, t("saveFailed"));
    } finally {
      setPending(false);
    }
  }

  const id = property?.id ?? "new";

  function field(
    key: string,
    label: string,
    control: (props: { id: string; "aria-invalid"?: true }) => React.ReactNode,
    description?: React.ReactNode,
  ) {
    const messages = errors[key];
    const inputId = `property-${id}-${key}`;
    return (
      <Field data-invalid={messages ? true : undefined}>
        <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
        {control({ id: inputId, ...(messages && { "aria-invalid": true }) })}
        {description ? <FieldDescription>{description}</FieldDescription> : null}
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
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {property ? t("editTitle", { name: property.name }) : t("addTitle")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form id={`property-form-${id}`} onSubmit={submit} noValidate>
          <FieldGroup>
            {field("name", t("name"), (props) => (
              <Input
                {...props}
                value={values.name}
                onChange={(event) => set("name", event.target.value)}
                required
                maxLength={100}
                autoComplete="off"
              />
            ))}
            {field("address", t("address"), (props) => (
              <Input
                {...props}
                value={values.address}
                onChange={(event) => set("address", event.target.value)}
                maxLength={500}
                autoComplete="street-address"
              />
            ))}
            <div className="grid gap-5 sm:grid-cols-2">
              {field("timezone", t("timezone"), (props) => (
                <NativeSelect
                  {...props}
                  className="w-full"
                  value={values.timezone}
                  onChange={(event) => set("timezone", event.target.value)}
                >
                  {timeZones.map((zone) => (
                    <NativeSelectOption key={zone} value={zone}>
                      {zone}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ))}
              {field("currency", t("currency"), (props) => (
                <NativeSelect
                  {...props}
                  className="w-full"
                  value={values.currency}
                  onChange={(event) => set("currency", event.target.value)}
                >
                  {currencies.map(({ code, name }) => (
                    <NativeSelectOption key={code} value={code}>
                      {code} – {name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ))}
              {field(
                "defaultNightlyRateMinor",
                t("nightlyRate"),
                (props) => (
                  <Input
                    {...props}
                    inputMode="decimal"
                    value={values.nightlyRate}
                    onChange={(event) => set("nightlyRate", event.target.value)}
                    placeholder={minorToInput(0, values.currency)}
                  />
                ),
                tForms("inCurrency", { currency: values.currency }),
              )}
              {field(
                "defaultCleaningFeeMinor",
                t("cleaningFee"),
                (props) => (
                  <Input
                    {...props}
                    inputMode="decimal"
                    value={values.cleaningFee}
                    onChange={(event) => set("cleaningFee", event.target.value)}
                    placeholder={minorToInput(0, values.currency)}
                  />
                ),
                tForms("inCurrency", { currency: values.currency }),
              )}
            </div>
            {field(
              "color",
              t("color"),
              (props) => (
                <Input
                  {...props}
                  type="color"
                  className="h-9 w-16 cursor-pointer p-1"
                  value={values.color}
                  onChange={(event) => set("color", event.target.value)}
                />
              ),
              t("colorHint"),
            )}
            <FieldSet>
              <FieldLegend variant="label">{t("publicListing")}</FieldLegend>
              <FieldDescription>{t("publicListingHint")}</FieldDescription>
              {field(
                "slug",
                t("slug"),
                (props) => (
                  <Input
                    {...props}
                    value={values.slug}
                    onChange={(event) => set("slug", event.target.value)}
                    maxLength={60}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="lake-house"
                  />
                ),
                t("slugHint", { path: `/stay/${values.slug.trim().toLowerCase() || "…"}` }),
              )}
              <Field
                orientation="horizontal"
                data-invalid={errors.publiclyListed ? true : undefined}
              >
                <Checkbox
                  id={`property-${id}-publiclyListed`}
                  checked={values.publiclyListed}
                  onCheckedChange={(checked) => set("publiclyListed", checked)}
                  disabled={!canList && !values.publiclyListed}
                  {...(!canList && { "aria-describedby": `property-${id}-needsLegal` })}
                  {...(errors.publiclyListed && { "aria-invalid": true })}
                />
                <FieldContent>
                  <FieldLabel htmlFor={`property-${id}-publiclyListed`} className="font-normal">
                    {t("publiclyListed")}
                  </FieldLabel>
                  {!canList ? (
                    <FieldDescription id={`property-${id}-needsLegal`}>
                      {t("needsLegal")}
                    </FieldDescription>
                  ) : null}
                  <FieldError
                    errors={errors.publiclyListed?.map((message) => ({
                      message: tForms("fieldError", { label: t("publiclyListed"), message }),
                    }))}
                  />
                </FieldContent>
              </Field>
            </FieldSet>
            {errors._ ? <FieldError errors={errors._.map((message) => ({ message }))} /> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => openChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" form={`property-form-${id}`} disabled={pending} aria-busy={pending}>
            {pending ? tCommon("saving") : property ? tCommon("save") : t("add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
