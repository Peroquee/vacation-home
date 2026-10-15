"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useApiText } from "@/i18n/use-api-text";
import type { SentRequest } from "@/lib/booking-requests/service";
import { type SolvedChallenge, solvedChallenge } from "@/lib/booking-requests/solve";
import { HONEYPOT_FIELD, MESSAGE_MAX } from "@/lib/booking-requests/values";
import type { CalendarDate } from "@/lib/calendar-date";

type Values = {
  name: string;
  email: string;
  phone: string;
  guestCount: string;
  message: string;
  consent: boolean;
};

type FieldErrors = Record<string, string[] | undefined>;

/** The form's own fields; the server's messages on any other go above the button. */
const FORM_FIELDS = ["name", "email", "phone", "guestCount", "message", "consent"] as const;

/**
 * The server refuses a request sent sooner than this after its challenge
 * was issued (MIN_FILL_MS in src/lib/booking-requests/challenge.ts, plus a
 * margin): only a fresh challenge fetched for a retry can come that close.
 */
const MIN_WAIT_MS = 3_500;

type Solving = { started: number; result: Promise<SolvedChallenge> };

function startSolving(slug: string): Solving {
  const result = solvedChallenge(slug);
  // Awaited on submit; until then a failure must not be "unhandled".
  result.catch(() => {});
  return { started: Date.now(), result };
}

/**
 * The booking request form (GitLab #109), shown once the guest has chosen a
 * stay. Asks only what the owner needs to answer. The spam check runs by
 * itself in the background while the guest types (./solve.ts); there is
 * nothing to click or solve.
 */
export function RequestForm({
  slug,
  checkIn,
  checkOut,
  maxGuests,
  cancellation,
  onSent,
  onDatesRefused,
}: {
  slug: string;
  checkIn: CalendarDate;
  checkOut: CalendarDate;
  maxGuests: number | null;
  /** The cancellation policy (GitLab #116), shown above the consent. */
  cancellation?: React.ReactNode;
  onSent: (request: SentRequest) => void;
  /** The dates were taken or became impossible since they were shown. */
  onDatesRefused: () => void;
}) {
  const t = useTranslations("stay.request");
  const tForms = useTranslations("forms");
  const api = useApiText();
  const locale = useLocale();
  const [values, setValues] = useState<Values>({
    name: "",
    email: "",
    phone: "",
    guestCount: "1",
    message: "",
    consent: false,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const honeypot = useRef<HTMLInputElement>(null);
  const solving = useRef<Solving | null>(null);

  useEffect(() => {
    solving.current = startSolving(slug);
  }, [slug]);

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function send(altcha: SolvedChallenge): Promise<Response> {
    const count = values.guestCount.trim();
    return fetch(`/api/public/properties/${slug}/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checkIn,
        checkOut,
        // Not a whole number: sent as typed, for the server to refuse.
        guestCount: /^\d+$/.test(count) ? Number(count) : count,
        name: values.name,
        email: values.email,
        phone: values.phone,
        message: values.message,
        consent: values.consent,
        locale,
        [HONEYPOT_FIELD]: honeypot.current?.value ?? "",
        altcha,
      }),
    });
  }

  /** A solved challenge, waiting for the solving or starting it again if it failed. */
  async function challenge(fresh: boolean): Promise<SolvedChallenge> {
    if (fresh || !solving.current) solving.current = startSolving(slug);
    let current = solving.current;
    try {
      await current.result;
    } catch {
      solving.current = current = startSolving(slug);
    }
    const wait = current.started + MIN_WAIT_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    return current.result;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    try {
      let response = await send(await challenge(false));
      let body = await response.json().catch(() => null);
      // Expired or already used: once more with a new one, by itself.
      if (response.status === 422 && body?.error?.fields?.altcha) {
        response = await send(await challenge(true));
        body = await response.json().catch(() => null);
      }
      if (response.status === 201) {
        onSent(body as SentRequest);
        return;
      }
      if (response.status === 422 && body?.error?.fields) {
        const fields: FieldErrors = api.fields(body.error.fields);
        setErrors(fields);
        if (fields.checkIn || fields.checkOut) onDatesRefused();
        return;
      }
      setErrors({
        _: [api.message(body) ?? t("failed", { status: response.status })],
      });
    } catch {
      setErrors({ _: [t("offline")] });
    } finally {
      setPending(false);
    }
  }

  function messages(key: string, label: string) {
    return errors[key]?.map((message) => ({ message: tForms("fieldError", { label, message }) }));
  }

  function textField(
    key: "name" | "email" | "phone",
    props: React.ComponentProps<typeof Input>,
    hint?: string,
  ) {
    const label = t(`fields.${key}`);
    return (
      <Field data-invalid={errors[key] ? true : undefined}>
        <FieldLabel htmlFor={`request-${key}`}>{label}</FieldLabel>
        <Input
          id={`request-${key}`}
          name={key}
          value={values[key]}
          onChange={(event) => set(key, event.target.value)}
          {...(errors[key] && { "aria-invalid": true })}
          {...props}
        />
        {hint ? <FieldDescription>{hint}</FieldDescription> : null}
        <FieldError errors={messages(key, label)} />
      </Field>
    );
  }

  // Messages for anything but the form's own fields: the dates, the spam check.
  const other = Object.entries(errors)
    .filter(([key]) => !(FORM_FIELDS as readonly string[]).includes(key))
    .flatMap(([key, list]) =>
      (list ?? []).map((message) =>
        key === "_" || key === "altcha"
          ? message
          : tForms("fieldError", {
              label: key === "checkIn" ? t("arrival") : key === "checkOut" ? t("departure") : key,
              message,
            }),
      ),
    );

  return (
    <form onSubmit={submit} noValidate aria-labelledby="request-heading" className="space-y-4">
      <h3 id="request-heading" className="text-base font-semibold">
        {t("heading")}
      </h3>
      <p className="text-muted-foreground text-sm">{t("intro")}</p>
      <FieldGroup>
        {textField("name", { autoComplete: "name", required: true, maxLength: 200 })}
        {textField("email", {
          type: "email",
          autoComplete: "email",
          required: true,
          maxLength: 320,
        })}
        {textField("phone", { type: "tel", autoComplete: "tel", maxLength: 50 }, t("optional"))}
        <Field data-invalid={errors.guestCount ? true : undefined}>
          <FieldLabel htmlFor="request-guestCount">{t("fields.guestCount")}</FieldLabel>
          <Input
            id="request-guestCount"
            name="guestCount"
            type="number"
            inputMode="numeric"
            min={1}
            max={maxGuests ?? 50}
            required
            className="w-24"
            value={values.guestCount}
            onChange={(event) => set("guestCount", event.target.value)}
            {...(errors.guestCount && { "aria-invalid": true })}
          />
          {maxGuests !== null ? (
            <FieldDescription>{t("maxGuests", { count: maxGuests })}</FieldDescription>
          ) : null}
          <FieldError errors={messages("guestCount", t("fields.guestCount"))} />
        </Field>
        <Field data-invalid={errors.message ? true : undefined}>
          <FieldLabel htmlFor="request-message">{t("fields.message")}</FieldLabel>
          <Textarea
            id="request-message"
            name="message"
            rows={4}
            maxLength={MESSAGE_MAX}
            value={values.message}
            onChange={(event) => set("message", event.target.value)}
            {...(errors.message && { "aria-invalid": true })}
          />
          <FieldDescription>{t("optional")}</FieldDescription>
          <FieldError errors={messages("message", t("fields.message"))} />
        </Field>
        {cancellation}
        <Field orientation="horizontal" data-invalid={errors.consent ? true : undefined}>
          <input
            id="request-consent"
            name="consent"
            type="checkbox"
            required
            className="mt-0.5 size-4 shrink-0"
            checked={values.consent}
            onChange={(event) => set("consent", event.target.checked)}
            {...(errors.consent && { "aria-invalid": true })}
          />
          <div className="space-y-1">
            <FieldLabel htmlFor="request-consent" className="font-normal">
              {t.rich("consent", {
                link: (chunks) => (
                  <Link href="/stay/legal/privacy" target="_blank" className="underline">
                    {chunks}
                  </Link>
                ),
              })}
            </FieldLabel>
            <FieldError errors={messages("consent", t("fields.consent"))} />
          </div>
        </Field>
      </FieldGroup>

      {/* The honeypot: hidden from people and screen readers, tempting to bots. */}
      <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor={`request-${HONEYPOT_FIELD}`}>{t("honeypot")}</label>
        <input
          ref={honeypot}
          id={`request-${HONEYPOT_FIELD}`}
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      {other.length > 0 ? (
        <div role="alert" className="text-destructive space-y-1 text-sm">
          {other.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}

      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? t("sending") : t("send")}
      </Button>
      <p className="text-muted-foreground text-xs">{t("noBooking")}</p>
    </form>
  );
}
