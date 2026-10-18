"use client";

import { useTranslations } from "next-intl";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type GuestSplit, groupKey } from "@/lib/pricing/tourist-tax";

/** The guests as typed: adults, and children by the Kurtaxe's age groups. */
export type GuestValues = { adults: string; children: Record<string, string> };

export const guestValues = (
  split: GuestSplit,
  groups: { fromAge: number; toAge: number }[],
): GuestValues => ({
  adults: String(split.adults),
  children: Object.fromEntries(
    groups.map((g) => [
      groupKey(g),
      String(split.children.find((c) => groupKey(c) === groupKey(g))?.count ?? 0),
    ]),
  ),
});

/** The split the values make, or null while one is not a whole number. */
export function guestSplitOf(
  values: GuestValues,
  groups: { fromAge: number; toAge: number }[],
): GuestSplit | null {
  const whole = (text: string | undefined) =>
    /^\d+$/.test((text ?? "").trim()) ? Number(text) : null;
  const adults = whole(values.adults);
  if (adults === null) return null;
  const children = [];
  for (const g of groups) {
    const count = whole(values.children[groupKey(g)] ?? "0");
    if (count === null) return null;
    if (count > 0) children.push({ fromAge: g.fromAge, toAge: g.toAge, count });
  }
  return { adults, children };
}

/**
 * Who stays (GitLab #120): only as detailed as the Kurtaxe needs. Without
 * child age groups, one count, as before; with them, adults and the number
 * of children per group - never birth dates.
 */
export function GuestFields({
  idPrefix,
  groups,
  values,
  onChange,
  errors,
  hint,
  max = 50,
}: {
  idPrefix: string;
  groups: { fromAge: number; toAge: number }[];
  values: GuestValues;
  onChange: (values: GuestValues) => void;
  /** Already worded with the field's label. */
  errors?: { message: string }[];
  hint?: string;
  max?: number;
}) {
  const t = useTranslations("guestFields");
  const count = (id: string, label: string, value: string, set: (v: string) => void, min = 0) => (
    <Field key={id} className="max-w-40" data-invalid={errors?.length ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(event) => set(event.target.value)}
        {...(errors?.length && { "aria-invalid": true })}
      />
    </Field>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4">
        {count(
          `${idPrefix}-adults`,
          groups.length > 0 ? t("adults") : t("guests"),
          values.adults,
          (adults) => onChange({ ...values, adults }),
          groups.length > 0 ? 0 : 1,
        )}
        {groups.map((g) =>
          count(
            `${idPrefix}-children-${groupKey(g)}`,
            t("children", { from: g.fromAge, to: g.toAge }),
            values.children[groupKey(g)] ?? "0",
            (n) => onChange({ ...values, children: { ...values.children, [groupKey(g)]: n } }),
          ),
        )}
      </div>
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
      <FieldError errors={errors} />
    </div>
  );
}
