"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useApiText } from "@/i18n/use-api-text";
import type { StayTimes } from "@/lib/listing/stay-times";

type Key = keyof StayTimes;
const KEYS: Key[] = ["checkInTime", "earliestCheckOutTime", "checkOutTime"];

const toValues = (times: StayTimes) =>
  Object.fromEntries(KEYS.map((key) => [key, times[key] ?? ""])) as Record<Key, string>;

/**
 * The property's arrival and departure times (GitLab #126): the earliest
 * arrival, the earliest and the latest departure, each optional.
 */
export function StayTimesCard({ propertyId, initial }: { propertyId: string; initial: StayTimes }) {
  const router = useRouter();
  const t = useTranslations("listing.stayTimes");
  const tForms = useTranslations("forms");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const [values, setValues] = useState(() => toValues(initial));
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const response = await fetch(`/api/properties/${propertyId}/stay-times`, {
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

  return (
    <Card id="stay-times">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-3">
            {KEYS.map((key) => {
              const label = t(key);
              const messages = errors[key];
              const id = `stay-times-${key}`;
              return (
                <Field key={key} data-invalid={messages ? true : undefined}>
                  <FieldLabel htmlFor={id}>{label}</FieldLabel>
                  <Input
                    id={id}
                    type="time"
                    value={values[key]}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [key]: event.target.value }))
                    }
                    {...(messages && { "aria-invalid": true })}
                  />
                  <FieldDescription>{t("optional")}</FieldDescription>
                  <FieldError
                    errors={messages?.map((message) => ({
                      message: tForms("fieldError", { label, message }),
                    }))}
                  />
                </Field>
              );
            })}
          </div>
          {errors._ ? <FieldError errors={errors._.map((message) => ({ message }))} /> : null}
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending ? tCommon("saving") : tCommon("save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
