"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

import type { LedgerCategory } from "./transaction-dialog";

type Type = "income" | "expense";

/**
 * The ledger filter's type and category (GitLab #129): with a type chosen,
 * only its categories are offered, and a category of the other type is
 * cleared when the type changes - never kept, never sent. Both stay plain
 * fields of the filter form (`type`, `categoryId`).
 */
export function TypeCategoryFilter({
  categories,
  type: initialType,
  categoryId: initialCategory,
}: {
  categories: Pick<LedgerCategory, "id" | "name" | "type">[];
  type: Type | undefined;
  categoryId: string | undefined;
}) {
  const t = useTranslations("finance.page");
  const fits = (id: string, type: Type | "") =>
    type === "" || categories.some((c) => c.id === id && c.type === type);
  const [type, setType] = useState<Type | "">(initialType ?? "");
  const [categoryId, setCategoryId] = useState(() =>
    initialCategory && fits(initialCategory, initialType ?? "") ? initialCategory : "",
  );
  const choices = type === "" ? categories : categories.filter((c) => c.type === type);

  return (
    <>
      <Field>
        <FieldLabel htmlFor="ledger-type">{t("type")}</FieldLabel>
        <NativeSelect
          id="ledger-type"
          name="type"
          className="w-full"
          value={type}
          onChange={(event) => {
            const next = event.target.value as Type | "";
            setType(next);
            if (!fits(categoryId, next)) setCategoryId("");
          }}
        >
          <NativeSelectOption value="">{t("bothTypes")}</NativeSelectOption>
          <NativeSelectOption value="income">{t("income")}</NativeSelectOption>
          <NativeSelectOption value="expense">{t("expenses")}</NativeSelectOption>
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="ledger-category">{t("category")}</FieldLabel>
        <NativeSelect
          id="ledger-category"
          name="categoryId"
          className="w-full"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          <NativeSelectOption value="">{t("anyCategory")}</NativeSelectOption>
          {choices.map((c) => (
            <NativeSelectOption key={c.id} value={c.id}>
              {/* With both types, which one each is. */}
              {type === ""
                ? t(c.type === "income" ? "categoryIncome" : "categoryExpense", { name: c.name })
                : c.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
    </>
  );
}
