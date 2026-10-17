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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useApiText } from "@/i18n/use-api-text";
import { imprintComplete, type Legal, LEGAL_LIMITS } from "@/lib/legal/legal";

export type PolicyTemplates = { de: string; en: string };

type Errors = Record<string, string[] | undefined>;

/**
 * The public site's legal pages (GitLab #112): the Impressum and the
 * privacy policy, one set for the whole site. No property can be listed
 * until both are filled in; the policy starts from a template made from
 * what the app does.
 */
export function LegalSection({ legal, templates }: { legal: Legal; templates: PolicyTemplates }) {
  const t = useTranslations("settings.legal");
  const policyDone = legal.privacyPolicyDe !== null && legal.privacyPolicyEn !== null;
  return (
    <Card id="legal">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-lg border text-sm">
          <li className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div>
              <div className="font-medium">{t("imprint.title")}</div>
              <div className="text-muted-foreground">
                {imprintComplete(legal) ? legal.imprintName : t("notFilledIn")}
              </div>
            </div>
            <ImprintDialog legal={legal} />
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div>
              <div className="font-medium">{t("privacy.title")}</div>
              <div className="text-muted-foreground">
                {policyDone ? t("privacy.bothLanguages") : t("notFilledIn")}
              </div>
            </div>
            <PrivacyDialog legal={legal} templates={templates} />
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

/** Saves the whole set: `legal` with `changes`. Field errors, or null when saved. */
function useSave() {
  const t = useTranslations("settings.legal");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function save(legal: Legal, changes: Partial<Legal>): Promise<Errors | null> {
    setPending(true);
    try {
      const response = await fetch("/api/legal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...legal, ...changes }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (response.status === 422 && body?.error?.fields) return api.fields(body.error.fields);
        throw new Error(
          api.message(body) ?? tCommon("serverAnswered", { status: response.status }),
        );
      }
      toastSuccess(t("saved"));
      router.refresh();
      return null;
    } catch (error) {
      toastError(error, t("saveFailed"));
      return {};
    } finally {
      setPending(false);
    }
  }
  return { save, pending };
}

function FieldErrors({ label, messages }: { label: string; messages?: string[] }) {
  const tForms = useTranslations("forms");
  return (
    <FieldError
      errors={messages?.map((message) => ({ message: tForms("fieldError", { label, message }) }))}
    />
  );
}

const IMPRINT = [
  "imprintName",
  "imprintAddress",
  "imprintEmail",
  "imprintPhone",
  "imprintVatId",
  "imprintExtra",
] as const;
type ImprintKey = (typeof IMPRINT)[number];

function ImprintDialog({ legal }: { legal: Legal }) {
  const t = useTranslations("settings.legal");
  const tCommon = useTranslations("common");
  const { save, pending } = useSave();
  const initial = () =>
    Object.fromEntries(IMPRINT.map((key) => [key, legal[key] ?? ""])) as Record<ImprintKey, string>;
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const failed = await save(legal, values);
    if (failed) setErrors(failed);
    else setOpen(false);
  }

  const field = (key: ImprintKey) => {
    const label = t(`imprint.fields.${key}`);
    const multiline = key === "imprintAddress" || key === "imprintExtra";
    const props = {
      id: `legal-${key}`,
      value: values[key],
      maxLength:
        key === "imprintExtra"
          ? LEGAL_LIMITS.extra
          : key === "imprintAddress"
            ? LEGAL_LIMITS.address
            : LEGAL_LIMITS.line,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setValues({ ...values, [key]: event.target.value }),
      ...(errors[key] && { "aria-invalid": true as const }),
    };
    return (
      <Field key={key} data-invalid={errors[key] ? true : undefined}>
        <FieldLabel htmlFor={props.id}>{label}</FieldLabel>
        {multiline ? (
          <Textarea {...props} rows={key === "imprintAddress" ? 3 : 4} />
        ) : (
          <Input
            {...props}
            {...(key === "imprintEmail" && { type: "email", autoComplete: "email" })}
            {...(key === "imprintPhone" && { type: "tel", autoComplete: "tel" })}
          />
        )}
        {key === "imprintAddress" || key === "imprintExtra" ? (
          <FieldDescription>{t(`imprint.hints.${key}`)}</FieldDescription>
        ) : null}
        <FieldErrors label={label} messages={errors[key]} />
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
          <Button variant="outline" size="sm" aria-label={t("imprint.edit")}>
            {tCommon("edit")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("imprint.title")}</DialogTitle>
          <DialogDescription>{t("imprint.description")}</DialogDescription>
        </DialogHeader>
        <form id="legal-imprint-form" onSubmit={submit} noValidate>
          <FieldGroup>{IMPRINT.map(field)}</FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" form="legal-imprint-form" disabled={pending} aria-busy={pending}>
            {pending ? tCommon("saving") : tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const POLICIES = [
  { key: "privacyPolicyDe", template: "de", language: "german" },
  { key: "privacyPolicyEn", template: "en", language: "english" },
] as const;

function PrivacyDialog({ legal, templates }: { legal: Legal; templates: PolicyTemplates }) {
  const t = useTranslations("settings.legal");
  const tCommon = useTranslations("common");
  const { save, pending } = useSave();
  // An empty policy starts from the template.
  const initial = () => ({
    privacyPolicyDe: legal.privacyPolicyDe ?? templates.de,
    privacyPolicyEn: legal.privacyPolicyEn ?? templates.en,
  });
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const failed = await save(legal, values);
    if (failed) setErrors(failed);
    else setOpen(false);
  }

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
          <Button variant="outline" size="sm" aria-label={t("privacy.edit")}>
            {tCommon("edit")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("privacy.title")}</DialogTitle>
          <DialogDescription>{t("privacy.description")}</DialogDescription>
        </DialogHeader>
        <p className="border-s-4 border-amber-500 ps-3 text-sm" role="note">
          {t("privacy.templateNote")}
        </p>
        <form id="legal-privacy-form" onSubmit={submit} noValidate>
          <FieldGroup>
            {POLICIES.map(({ key, template, language }) => {
              const label = t(`privacy.${language}`);
              return (
                <Field key={key} data-invalid={errors[key] ? true : undefined}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <FieldLabel htmlFor={`legal-${key}`}>{label}</FieldLabel>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t("privacy.useTemplateFor", { language: label })}
                      onClick={() => setValues({ ...values, [key]: templates[template] })}
                    >
                      {t("privacy.useTemplate")}
                    </Button>
                  </div>
                  <Textarea
                    id={`legal-${key}`}
                    className="max-h-[40vh] font-mono text-sm"
                    rows={12}
                    maxLength={LEGAL_LIMITS.policy}
                    value={values[key]}
                    onChange={(event) => setValues({ ...values, [key]: event.target.value })}
                    {...(errors[key] && { "aria-invalid": true })}
                  />
                  <FieldErrors label={label} messages={errors[key]} />
                </Field>
              );
            })}
            <FieldDescription>{t("privacy.markdownHint")}</FieldDescription>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" form="legal-privacy-form" disabled={pending} aria-busy={pending}>
            {pending ? tCommon("saving") : tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
