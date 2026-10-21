"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { useApiText } from "@/i18n/use-api-text";
import type { ListingDto } from "@/lib/listing/service";
import { AMENITIES, LISTING_LIMITS } from "@/lib/listing/values";

type FieldErrors = Record<string, string[] | undefined>;
type TextKey =
  | "titleEn"
  | "titleDe"
  | "descriptionEn"
  | "descriptionDe"
  | "houseRulesEn"
  | "houseRulesDe"
  | "location"
  | "exactAddress"
  | "arrivalNotes";
type Values = Record<TextKey, string> & {
  maxGuests: string;
  bedrooms: string;
  bathrooms: string;
  amenities: string[];
};

function toValues(listing: ListingDto): Values {
  const count = (n: number | null) => (n === null ? "" : String(n));
  return {
    titleEn: listing.titleEn,
    titleDe: listing.titleDe,
    descriptionEn: listing.descriptionEn,
    descriptionDe: listing.descriptionDe,
    houseRulesEn: listing.houseRulesEn,
    houseRulesDe: listing.houseRulesDe,
    location: listing.location,
    exactAddress: listing.exactAddress,
    arrivalNotes: listing.arrivalNotes,
    maxGuests: count(listing.maxGuests),
    bedrooms: count(listing.bedrooms),
    bathrooms: count(listing.bathrooms),
    amenities: listing.amenities,
  };
}

/** A whole number, null for blank, or the text as typed for the API to refuse. */
function toCount(text: string): number | string | null {
  const value = text.trim();
  if (value === "") return null;
  return /^\d+$/.test(value) ? Number(value) : value;
}

/** The listing profile: facts, amenities, and the texts in both languages. */
export function ListingForm({ propertyId, initial }: { propertyId: string; initial: ListingDto }) {
  const router = useRouter();
  const t = useTranslations("listing.form");
  const tAmenities = useTranslations("listing.amenities");
  const tForms = useTranslations("forms");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const [values, setValues] = useState(() => toValues(initial));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const response = await fetch(`/api/properties/${propertyId}/listing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          maxGuests: toCount(values.maxGuests),
          bedrooms: toCount(values.bedrooms),
          bathrooms: toCount(values.bathrooms),
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
      setErrors({});
      setValues(toValues(await response.json()));
      toastSuccess(t("saved"));
      router.refresh();
    } catch (error) {
      toastError(error, t("saveFailed"));
    } finally {
      setPending(false);
    }
  }

  function field(
    key: keyof Values,
    label: string,
    control: (props: { id: string; "aria-invalid"?: true }) => React.ReactNode,
    hint?: string,
  ) {
    const messages = errors[key];
    const id = `listing-${key}`;
    return (
      <Field data-invalid={messages ? true : undefined}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {control({ id, ...(messages && { "aria-invalid": true }) })}
        {hint ? <FieldDescription>{hint}</FieldDescription> : null}
        <FieldError
          errors={messages?.map((message) => ({
            message: tForms("fieldError", { label, message }),
          }))}
        />
      </Field>
    );
  }

  const textInput = (key: TextKey, max: number) =>
    function TextControl(props: { id: string }) {
      return (
        <Input
          {...props}
          value={values[key]}
          maxLength={max}
          onChange={(event) => set(key, event.target.value)}
        />
      );
    };
  const textArea = (key: TextKey, max: number) =>
    function TextAreaControl(props: { id: string }) {
      return (
        <Textarea
          {...props}
          rows={6}
          value={values[key]}
          maxLength={max}
          onChange={(event) => set(key, event.target.value)}
        />
      );
    };
  const countInput = (key: "maxGuests" | "bedrooms" | "bathrooms") =>
    function CountControl(props: { id: string }) {
      return (
        <Input
          {...props}
          inputMode="numeric"
          value={values[key]}
          onChange={(event) => set(key, event.target.value)}
        />
      );
    };

  const language = (suffix: "En" | "De") => (
    <FieldSet>
      <FieldLegend>{t(`language${suffix}`)}</FieldLegend>
      {field(`title${suffix}`, t("title"), textInput(`title${suffix}`, LISTING_LIMITS.title))}
      {field(
        `description${suffix}`,
        t("description"),
        textArea(`description${suffix}`, LISTING_LIMITS.description),
      )}
      {field(
        `houseRules${suffix}`,
        t("houseRules"),
        textArea(`houseRules${suffix}`, LISTING_LIMITS.houseRules),
      )}
    </FieldSet>
  );

  return (
    <Card id="listing-profile">
      <CardHeader>
        <CardTitle>{t("heading")}</CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            {field(
              "location",
              t("location"),
              textInput("location", LISTING_LIMITS.location),
              t("locationHint"),
            )}
            <div className="grid gap-5 sm:grid-cols-3">
              {field("maxGuests", t("maxGuests"), countInput("maxGuests"))}
              {field("bedrooms", t("bedrooms"), countInput("bedrooms"))}
              {field("bathrooms", t("bathrooms"), countInput("bathrooms"))}
            </div>
            <FieldSet>
              <FieldLegend variant="label">{t("amenities")}</FieldLegend>
              <div className="grid gap-2 sm:grid-cols-3">
                {AMENITIES.map((amenity) => (
                  <Field key={amenity} orientation="horizontal">
                    <Checkbox
                      id={`listing-amenity-${amenity}`}
                      checked={values.amenities.includes(amenity)}
                      onCheckedChange={(checked) =>
                        set(
                          "amenities",
                          checked
                            ? [...values.amenities, amenity]
                            : values.amenities.filter((a) => a !== amenity),
                        )
                      }
                    />
                    <FieldLabel htmlFor={`listing-amenity-${amenity}`} className="font-normal">
                      {tAmenities(amenity)}
                    </FieldLabel>
                  </Field>
                ))}
              </div>
            </FieldSet>
            <div className="grid gap-8 lg:grid-cols-2">
              {language("En")}
              {language("De")}
            </div>
            <FieldSet>
              <FieldLegend>{t("private")}</FieldLegend>
              <FieldDescription>{t("privateHint")}</FieldDescription>
              {field(
                "exactAddress",
                t("exactAddress"),
                textArea("exactAddress", LISTING_LIMITS.exactAddress),
              )}
              {field(
                "arrivalNotes",
                t("arrivalNotes"),
                textArea("arrivalNotes", LISTING_LIMITS.arrivalNotes),
                t("arrivalNotesHint"),
              )}
            </FieldSet>
            {errors._ ? <FieldError errors={errors._.map((message) => ({ message }))} /> : null}
            <div>
              <Button type="submit" disabled={pending} aria-busy={pending}>
                {pending ? tCommon("saving") : tCommon("save")}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
