"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { toastError, toastSuccess } from "@/components/toast";
import { useConflictText } from "@/components/use-conflict-text";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  type Conflict,
  previewTotalMinor,
  type PropertyChoice,
  stayNights,
  turnoverFix,
} from "@/lib/bookings/form";
import { SOURCE_KEYS } from "@/lib/bookings/labels";
import { BOOKING_SOURCES, type BookingStatus, holdsDates } from "@/lib/bookings/values";
import type { RuleViolation } from "@/lib/booking-rules/rules";
import type { BookingDto } from "@/lib/bookings/service";
import { addDays, isCalendarDate } from "@/lib/calendar-date";
import { inputToMinor, minorToInput } from "@/lib/properties/form";
import { useAmountHint } from "@/i18n/use-amount-hint";
import { useApiText } from "@/i18n/use-api-text";
import { useFormat } from "@/i18n/use-format";

import { type GuestOption, GuestPicker } from "./guest-picker";
import { useRuleWarnings } from "./use-rule-warnings";
import { useStayAvailability } from "./use-stay-availability";

/** The booking being edited: its DTO, with the guest's email for the picker. */
export type EditableBooking = Omit<BookingDto, "guest"> & { guest: GuestOption };

type FieldErrors = Record<string, string[] | undefined>;

/** The order fields appear in, to focus the first invalid one. */
const FIELD_ORDER = [
  "propertyId",
  "guestId",
  "checkIn",
  "checkOut",
  "guestCount",
  "status",
  "source",
  "nightlyRateMinor",
  "cleaningFeeMinor",
  "totalAmountMinor",
  "notes",
] as const;

function initialValues(
  properties: PropertyChoice[],
  booking?: EditableBooking,
  preset: { propertyId?: string; checkIn?: string; checkOut?: string } = {},
) {
  if (booking) {
    return {
      propertyId: booking.propertyId,
      guest: booking.guest as GuestOption | null,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      guestCount: String(booking.guestCount),
      status: booking.status as string,
      source: booking.source as string,
      nightlyRate: minorToInput(booking.nightlyRateMinor, booking.currency),
      cleaningFee: minorToInput(booking.cleaningFeeMinor, booking.currency),
      overrideTotal: booking.totalIsManual,
      total: minorToInput(booking.totalAmountMinor, booking.currency),
      notes: booking.notes ?? "",
    };
  }
  const property =
    properties.find((p) => p.id === preset.propertyId) ??
    (properties.length === 1 ? properties[0] : undefined);
  return {
    propertyId: property?.id ?? "",
    guest: null as GuestOption | null,
    checkIn: preset.checkIn ?? "",
    checkOut: preset.checkOut ?? "",
    guestCount: "1",
    status: "inquiry",
    source: "direct",
    nightlyRate: property ? minorToInput(property.defaultNightlyRateMinor, property.currency) : "",
    cleaningFee: property ? minorToInput(property.defaultCleaningFeeMinor, property.currency) : "",
    overrideTotal: false,
    total: "",
    notes: "",
  };
}

type Values = ReturnType<typeof initialValues>;

/**
 * Creates a booking, or edits one when `booking` is given. Nights and the
 * total update as the dates and rates change, and the dates are checked
 * against the property's calendar before submit. The API checks again on
 * save; its 409 and per-field 422 answers show inline the same way.
 */
export function BookingForm({
  properties,
  booking,
  preset,
}: {
  /** Active properties. When editing, the booking's own property is included. */
  properties: PropertyChoice[];
  booking?: EditableBooking;
  preset?: { propertyId?: string; checkIn?: string; checkOut?: string };
}) {
  const router = useRouter();
  const amountHint = useAmountHint();
  const t = useTranslations("bookings");
  const tForms = useTranslations("forms");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const format = useFormat();
  const prefix = useId();
  const [values, setValues] = useState(() => initialValues(properties, booking, preset));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverConflicts, setServerConflicts] = useState<Conflict[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Rates follow the chosen property until the user changes them by hand.
  const [ratesEdited, setRatesEdited] = useState(Boolean(booking));

  const property = properties.find((p) => p.id === values.propertyId);
  const currency = booking?.currency ?? property?.currency ?? null;
  const fieldId = (key: string) => `${prefix}-${key}`;

  const nights = stayNights(values.checkIn, values.checkOut);
  const nightlyRateMinor = currency ? inputToMinor(values.nightlyRate, currency) : null;
  const cleaningFeeMinor = currency ? inputToMinor(values.cleaningFee, currency) : null;
  const calculated = previewTotalMinor({
    checkIn: values.checkIn,
    checkOut: values.checkOut,
    nightlyRateMinor,
    cleaningFeeMinor,
  });

  const availability = useStayAvailability(
    values.propertyId,
    values.checkIn,
    values.checkOut,
    booking?.id,
  );
  const ruleWarnings = useRuleWarnings(
    values.propertyId,
    values.checkIn,
    values.checkOut,
    booking?.id,
  );
  const conflicts = availability.state === "checked" ? availability.conflicts : [];
  const guestNames = availability.state === "checked" ? availability.guestNames : new Map();
  // Only a confirmed booking is refused for taken dates; an inquiry may overlap.
  const conflictBlocks = holdsDates(values.status as BookingStatus) && conflicts.length > 0;

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (key === "checkIn" || key === "checkOut" || key === "status") setServerConflicts(null);
  }

  function chooseProperty(id: string) {
    const next = properties.find((p) => p.id === id);
    setValues((current) => ({
      ...current,
      propertyId: id,
      ...(next &&
        !ratesEdited && {
          nightlyRate: minorToInput(next.defaultNightlyRateMinor, next.currency),
          cleaningFee: minorToInput(next.defaultCleaningFeeMinor, next.currency),
        }),
    }));
    setServerConflicts(null);
  }

  function showErrors(next: FieldErrors) {
    setErrors(next);
    const first = FIELD_ORDER.find((key) => next[key]);
    // After the render that marks it invalid, so screen readers hear both.
    if (first) requestAnimationFrame(() => document.getElementById(fieldId(first))?.focus());
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setServerConflicts(null);

    const local: FieldErrors = {};
    if (!values.propertyId) local.propertyId = [tForms("required")];
    if (!values.guest) local.guestId = [tForms("requiredGuest")];
    if (!values.checkIn) local.checkIn = [tForms("required")];
    if (!values.checkOut) local.checkOut = [tForms("required")];
    const amountError = currency ? amountHint(currency) : "";
    if (currency && nightlyRateMinor === null) local.nightlyRateMinor = [amountError];
    if (currency && cleaningFeeMinor === null) local.cleaningFeeMinor = [amountError];
    const totalMinor =
      currency && values.overrideTotal ? inputToMinor(values.total, currency) : null;
    if (values.overrideTotal && totalMinor === null) local.totalAmountMinor = [amountError];
    const guestCount = Number(values.guestCount);
    if (!Number.isInteger(guestCount)) local.guestCount = [tForms("wholeNumber")];
    if (Object.keys(local).length > 0) return showErrors(local);

    const body = {
      ...(!booking && { propertyId: values.propertyId }),
      guestId: values.guest!.id,
      checkIn: values.checkIn,
      checkOut: values.checkOut,
      status: values.status,
      source: values.source,
      guestCount,
      nightlyRateMinor,
      cleaningFeeMinor,
      // On edit, null hands the total back to the calculation.
      ...(values.overrideTotal
        ? { totalAmountMinor: totalMinor }
        : booking && { totalAmountMinor: null }),
      notes: values.notes,
    };

    setPending(true);
    try {
      const response = await fetch(booking ? `/api/bookings/${booking.id}` : "/api/bookings", {
        method: booking ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);
      if (response.status === 422 && result?.error?.fields) {
        const { _: general, ...fields } = api.fields(result.error.fields as FieldErrors);
        if (general) setFormError(general.join(" "));
        return showErrors(fields);
      }
      if (response.status === 409) {
        setServerConflicts(result?.error?.conflicts ?? []);
        // The conflicts are listed by the dates; the server's sentence would repeat them.
        setFormError(t("form.unavailable"));
        document.getElementById(fieldId("checkIn"))?.focus();
        return;
      }
      if (!response.ok) {
        throw new Error(
          api.message(result) ?? tCommon("serverAnswered", { status: response.status }),
        );
      }
      toastSuccess(booking ? t("form.saved") : t("form.added"));
      router.push(`/bookings/${booking?.id ?? result.id}`);
      router.refresh();
    } catch (error) {
      toastError(error, t("form.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  function field(
    key: string,
    label: string,
    control: (props: {
      id: string;
      "aria-invalid"?: true;
      "aria-describedby"?: string;
    }) => React.ReactNode,
    description?: React.ReactNode,
  ) {
    const messages = errors[key];
    return (
      <Field data-invalid={messages ? true : undefined}>
        <FieldLabel htmlFor={fieldId(key)}>{label}</FieldLabel>
        {control({
          id: fieldId(key),
          ...(messages && {
            "aria-invalid": true,
            "aria-describedby": `${fieldId(key)}-error`,
          }),
        })}
        {description ? <FieldDescription>{description}</FieldDescription> : null}
        <FieldError
          id={`${fieldId(key)}-error`}
          errors={messages?.map((message) => ({
            message: tForms("fieldError", { label, message }),
          }))}
        />
      </Field>
    );
  }

  const shownConflicts = serverConflicts ?? conflicts;
  // The booking's own status stays choosable; reserved and expired are
  // otherwise the booking flow's to set (GitLab #114).
  const statusOptions: BookingStatus[] =
    booking && !["inquiry", "confirmed"].includes(booking.status)
      ? ["inquiry", "confirmed", booking.status]
      : ["inquiry", "confirmed"];

  return (
    <form onSubmit={submit} noValidate className="max-w-2xl">
      <FieldGroup>
        {field("propertyId", t("form.property"), (props) => (
          <NativeSelect
            {...props}
            className="w-full"
            value={values.propertyId}
            onChange={(event) => chooseProperty(event.target.value)}
            // The property cannot change: the amounts are in its currency.
            disabled={Boolean(booking)}
          >
            {!values.propertyId ? (
              <NativeSelectOption value="" disabled>
                {t("form.chooseProperty")}
              </NativeSelectOption>
            ) : null}
            {properties.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ))}

        {field("guestId", t("form.guest"), (props) => (
          <GuestPicker
            id={props.id}
            invalid={Boolean(props["aria-invalid"])}
            value={values.guest}
            onChange={(guest) => set("guest", guest)}
          />
        ))}

        <div className="grid gap-5 sm:grid-cols-2">
          {field("checkIn", t("form.checkIn"), (props) => (
            <Input
              {...props}
              type="date"
              value={values.checkIn}
              onChange={(event) => {
                const checkIn = event.target.value;
                set("checkIn", checkIn);
                // Move an empty or now-invalid check-out to the next day.
                if (isCalendarDate(checkIn) && (!values.checkOut || values.checkOut <= checkIn)) {
                  set("checkOut", addDays(checkIn, 1));
                }
              }}
            />
          ))}
          {field("checkOut", t("form.checkOut"), (props) => (
            <Input
              {...props}
              type="date"
              min={values.checkIn || undefined}
              value={values.checkOut}
              onChange={(event) => set("checkOut", event.target.value)}
            />
          ))}
        </div>

        <AvailabilityNotice
          state={serverConflicts ? "checked" : availability.state}
          conflicts={shownConflicts}
          guestNames={guestNames}
          blocking={serverConflicts !== null || conflictBlocks}
          nights={nights}
          stay={{ checkIn: values.checkIn, checkOut: values.checkOut }}
          ignoreBookingId={booking?.id}
          onFix={(field, date) => set(field, date)}
        />
        <RuleWarnings
          warnings={ruleWarnings}
          labels={{ checkIn: t("form.checkIn"), checkOut: t("form.checkOut") }}
        />

        <div className="grid gap-5 sm:grid-cols-3">
          {field("guestCount", t("form.guests"), (props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              value={values.guestCount}
              onChange={(event) => set("guestCount", event.target.value)}
            />
          ))}
          {field("status", t("form.statusLabel"), (props) => (
            <NativeSelect
              {...props}
              className="w-full"
              value={values.status}
              onChange={(event) => set("status", event.target.value)}
            >
              {statusOptions.map((status) => (
                <NativeSelectOption key={status} value={status}>
                  {t(`status.${status}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ))}
          {field("source", t("form.sourceLabel"), (props) => (
            <NativeSelect
              {...props}
              className="w-full"
              value={values.source}
              onChange={(event) => set("source", event.target.value)}
            >
              {/* Only the public site makes a booking a website request. */}
              {BOOKING_SOURCES.filter(
                (source) => source !== "website" || values.source === "website",
              ).map((source) => (
                <NativeSelectOption key={source} value={source}>
                  {t(`source.${SOURCE_KEYS[source]}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ))}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {field(
            "nightlyRateMinor",
            t("form.nightlyRate"),
            (props) => (
              <Input
                {...props}
                inputMode="decimal"
                value={values.nightlyRate}
                onChange={(event) => {
                  setRatesEdited(true);
                  set("nightlyRate", event.target.value);
                }}
              />
            ),
            currency ? tForms("inCurrency", { currency }) : tForms("choosePropertyFirst"),
          )}
          {field(
            "cleaningFeeMinor",
            t("form.cleaningFee"),
            (props) => (
              <Input
                {...props}
                inputMode="decimal"
                value={values.cleaningFee}
                onChange={(event) => {
                  setRatesEdited(true);
                  set("cleaningFee", event.target.value);
                }}
              />
            ),
            currency ? tForms("inCurrency", { currency }) : undefined,
          )}
        </div>

        <div className="bg-muted/50 space-y-3 rounded-lg p-3">
          <p className="flex items-baseline justify-between gap-4" aria-live="polite">
            <span className="text-muted-foreground text-sm">
              {nights === null
                ? t("form.total")
                : t("form.nights", { count: nights }) +
                  (currency && nightlyRateMinor !== null
                    ? t("form.times", { rate: format.money(nightlyRateMinor, currency) })
                    : "") +
                  (currency && cleaningFeeMinor
                    ? t("form.plusCleaning", { fee: format.money(cleaningFeeMinor, currency) })
                    : "")}
            </span>
            <span className="text-lg font-medium tabular-nums">
              {currency && values.overrideTotal && inputToMinor(values.total, currency) !== null
                ? format.money(inputToMinor(values.total, currency)!, currency)
                : currency && calculated !== null
                  ? format.money(calculated, currency)
                  : "–"}
            </span>
          </p>
          <Field orientation="horizontal">
            <Checkbox
              id={fieldId("overrideTotal")}
              checked={values.overrideTotal}
              onCheckedChange={(checked) => {
                set("overrideTotal", checked);
                // Start the override from the calculated total.
                if (checked && !values.total && currency && calculated !== null) {
                  set("total", minorToInput(calculated, currency));
                }
              }}
            />
            <FieldLabel htmlFor={fieldId("overrideTotal")}>{t("form.overrideTotal")}</FieldLabel>
          </Field>
          {values.overrideTotal
            ? field(
                "totalAmountMinor",
                t("form.total"),
                (props) => (
                  <Input
                    {...props}
                    inputMode="decimal"
                    value={values.total}
                    onChange={(event) => set("total", event.target.value)}
                  />
                ),
                t("form.totalFixed"),
              )
            : null}
        </div>

        {field("notes", t("form.notes"), (props) => (
          <Textarea
            {...props}
            value={values.notes}
            maxLength={2000}
            onChange={(event) => set("notes", event.target.value)}
          />
        ))}

        {formError ? <FieldError>{formError}</FieldError> : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending ? tCommon("saving") : booking ? t("form.save") : t("form.add")}
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => router.back()}>
            {tCommon("cancel")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

/**
 * The property's booking rules the stay breaks. Advice, not an error: the
 * owner may book outside them; guests on the public site cannot.
 */
function RuleWarnings({
  warnings,
  labels,
}: {
  warnings: RuleViolation[];
  labels: Record<RuleViolation["field"], string>;
}) {
  const t = useTranslations("bookings.form");
  const tForms = useTranslations("forms");
  const api = useApiText();
  if (warnings.length === 0) return null;
  return (
    <div
      role="status"
      className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      <p className="font-medium">{t("outsideRules")}</p>
      <ul className="mt-1 list-disc pl-5">
        {warnings.map(({ field, rule, message }) => (
          <li key={`${field}-${rule}`}>
            {tForms("fieldError", { label: labels[field], message: api.text(message) })}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Says whether the dates are free, and if not, what is in the way. */
function AvailabilityNotice({
  state,
  conflicts,
  guestNames,
  blocking,
  nights,
  stay,
  ignoreBookingId,
  onFix,
}: {
  state: "idle" | "checking" | "failed" | "checked";
  conflicts: Conflict[];
  guestNames: ReadonlyMap<string, string>;
  blocking: boolean;
  nights: number | null;
  stay: { checkIn: string; checkOut: string };
  ignoreBookingId?: string;
  /** Applies a suggested changeover date. */
  onFix: (field: "checkIn" | "checkOut", date: string) => void;
}) {
  const t = useTranslations("bookings.form");
  const text = useConflictText();
  if (state === "idle" || nights === null) return null;
  if (state === "checked" && conflicts.length > 0) {
    return (
      <div
        role="alert"
        className={
          blocking
            ? "border-destructive/40 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm"
            : "rounded-lg border p-3 text-sm"
        }
      >
        <p className="font-medium">{blocking ? t("notAvailable") : t("overlap")}</p>
        <ul className="mt-1 list-disc pl-5">
          {conflicts.map((conflict) => (
            <li key={`${conflict.kind}-${conflict.id}`}>
              {conflict.kind === "booking" && conflict.id !== ignoreBookingId ? (
                <Link href={`/bookings/${conflict.id}`} target="_blank" className="underline">
                  {text.describe(conflict, guestNames)}
                </Link>
              ) : (
                text.describe(conflict, guestNames)
              )}
            </li>
          ))}
        </ul>
        {conflicts.map((conflict) => {
          const fix = turnoverFix(stay, conflict);
          return fix ? (
            <div
              key={`fix-${conflict.kind}-${conflict.id}`}
              className="mt-2 flex flex-wrap items-center gap-2"
            >
              <p>{text.fix(fix)}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onFix(fix.move, fix.to)}
              >
                {fix.move === "checkIn" ? t("useCheckIn") : t("useCheckOut")}
              </Button>
            </div>
          ) : null;
        })}
      </div>
    );
  }
  return (
    <p role="status" className="text-muted-foreground text-sm">
      {state === "checking"
        ? t("checking")
        : state === "failed"
          ? t("checkFailed")
          : t("available")}
    </p>
  );
}
