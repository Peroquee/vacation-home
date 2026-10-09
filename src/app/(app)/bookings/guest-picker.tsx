"use client";

import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useApiText } from "@/i18n/use-api-text";

export type GuestOption = { id: string; name: string; email: string | null };

type FieldErrors = Record<string, string[] | undefined>;

/** Guests matching `query`, as GET /api/guests returns them. */
async function searchGuests(query: string, signal: AbortSignal): Promise<GuestOption[]> {
  const params = new URLSearchParams({ limit: "10" });
  if (query) params.set("q", query);
  const response = await fetch(`/api/guests?${params}`, { signal });
  // Only whether it failed is shown.
  if (!response.ok) throw new Error(String(response.status));
  const guests: GuestOption[] = await response.json();
  return guests.map(({ id, name, email }) => ({ id, name, email }));
}

/**
 * Picks the booking's guest: a typeahead over existing guests, and a small
 * inline form to add one without leaving the booking. A new guest whose email
 * is already known comes back as that guest (the API never duplicates one).
 */
export function GuestPicker({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: GuestOption | null;
  onChange: (guest: GuestOption | null) => void;
  invalid?: boolean;
}) {
  const t = useTranslations("bookings.guestPicker");
  const [query, setQuery] = useState(value?.name ?? "");
  const [options, setOptions] = useState<GuestOption[]>(value ? [value] : []);
  const [searchFailed, setSearchFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  // Search as the user types, a moment after they stop, dropping stale answers.
  useEffect(() => {
    if (value && query === value.name) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchGuests(query.trim(), controller.signal)
        .then((guests) => {
          setOptions(guests);
          setSearchFailed(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) setSearchFailed(true);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, value]);

  if (creating) {
    return (
      <NewGuestForm
        initialName={value ? "" : query.trim()}
        onCancel={() => setCreating(false)}
        onCreated={(guest) => {
          setCreating(false);
          setOptions([guest]);
          setQuery(guest.name);
          onChange(guest);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <Combobox<GuestOption>
        items={options}
        value={value}
        onValueChange={(guest) => onChange(guest ?? null)}
        inputValue={query}
        onInputValueChange={setQuery}
        itemToStringLabel={(guest) => guest.name}
        isItemEqualToValue={(a, b) => a.id === b.id}
        // The server filters; the list shows whatever it returned.
        filter={null}
      >
        <ComboboxInput
          id={id}
          className="w-full"
          placeholder={t("search")}
          aria-invalid={invalid || undefined}
          showClear={value !== null}
        />
        <ComboboxContent>
          <ComboboxEmpty>{searchFailed ? t("searchFailed") : t("noMatch")}</ComboboxEmpty>
          <ComboboxList>
            {(guest: GuestOption) => (
              <ComboboxItem key={guest.id} value={guest}>
                <span className="truncate">{guest.name}</span>
                {guest.email ? (
                  <span className="text-muted-foreground truncate text-xs">{guest.email}</span>
                ) : null}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <Button type="button" variant="outline" onClick={() => setCreating(true)}>
        <UserPlus data-icon="inline-start" aria-hidden />
        {t("newGuest")}
      </Button>
    </div>
  );
}

/** Adds a guest inline. Not a nested <form>: it sits inside the booking form. */
function NewGuestForm({
  initialName,
  onCancel,
  onCreated,
}: {
  initialName: string;
  onCancel: () => void;
  onCreated: (guest: GuestOption) => void;
}) {
  const t = useTranslations("bookings.guestPicker");
  const tForms = useTranslations("forms");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const prefix = useId();
  const [values, setValues] = useState({ name: initialName, email: "", phone: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function create() {
    setPending(true);
    setFailure(null);
    try {
      const response = await fetch("/api/guests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json().catch(() => null);
      if (response.status === 422 && body?.error?.fields) {
        setErrors(api.fields(body.error.fields));
        return;
      }
      if (!response.ok) {
        throw new Error(
          api.message(body) ?? tCommon("serverAnswered", { status: response.status }),
        );
      }
      onCreated({ id: body.id, name: body.name, email: body.email });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : t("addFailed"));
    } finally {
      setPending(false);
    }
  }

  const fields = [
    { key: "name", label: t("name"), autoComplete: "name", type: "text" },
    { key: "email", label: t("email"), autoComplete: "email", type: "email" },
    { key: "phone", label: t("phone"), autoComplete: "tel", type: "tel" },
  ] as const;

  return (
    <FieldSet className="rounded-lg border p-3">
      <FieldLegend variant="label">{t("newGuest")}</FieldLegend>
      <FieldGroup className="gap-3">
        {fields.map(({ key, label, autoComplete, type }) => {
          const messages = errors[key];
          return (
            <Field key={key} data-invalid={messages ? true : undefined}>
              <FieldLabel htmlFor={`${prefix}-${key}`}>{label}</FieldLabel>
              <Input
                id={`${prefix}-${key}`}
                type={type}
                autoComplete={autoComplete}
                autoFocus={key === "name"}
                aria-invalid={messages ? true : undefined}
                value={values[key]}
                onChange={(event) => setValues((v) => ({ ...v, [key]: event.target.value }))}
                onKeyDown={(event) => {
                  // Enter adds the guest rather than submitting the booking.
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void create();
                  }
                }}
              />
              <FieldError
                errors={messages?.map((message) => ({
                  message: tForms("fieldError", { label, message }),
                }))}
              />
            </Field>
          );
        })}
        {failure ? <FieldError>{failure}</FieldError> : null}
        <div className="flex gap-2">
          <Button type="button" onClick={create} disabled={pending} aria-busy={pending}>
            {pending ? t("adding") : t("add")}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            {tCommon("cancel")}
          </Button>
        </div>
      </FieldGroup>
    </FieldSet>
  );
}
