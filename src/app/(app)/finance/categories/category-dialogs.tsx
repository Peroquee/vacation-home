"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useApiText } from "@/i18n/use-api-text";

export type CategoryRow = {
  id: string;
  name: string;
  type: "income" | "expense";
  color: string;
  isSystem: boolean;
  hidden: boolean;
};

type FieldErrors = Record<string, string[] | undefined>;

/** A failed request with the API's message, fields and 409 reason. */
class CategoryError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
    readonly fields?: FieldErrors,
  ) {
    super(message);
  }
}

async function request(
  url: string,
  fail: (body: unknown, status: number) => string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => null);
  if (response.ok) return body;
  throw new CategoryError(
    fail(body, response.status),
    response.status,
    body?.error?.reason,
    body?.error?.fields,
  );
}

/**
 * Moves every transaction of one category to another of the same type, in
 * one step on the server. The one place the move is made, so the endpoint
 * behind it can change without touching the dialogs.
 */
export async function reassign(
  fromId: string,
  toId: string,
  fail: (body: unknown, status: number) => string,
): Promise<{ moved: number }> {
  return (await request(`/api/categories/${fromId}/reassign`, fail, {
    method: "POST",
    body: JSON.stringify({ to: toId }),
  })) as { moved: number };
}

/** Adds a category, or edits one's name and colour when `category` is given. */
export function CategoryFormDialog({
  category,
  trigger,
}: {
  category?: CategoryRow;
  trigger: React.ReactElement;
}) {
  const router = useRouter();
  const t = useTranslations("finance.categoryDialogs");
  const tForms = useTranslations("forms");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const fail = (body: unknown, status: number) =>
    api.message(body) ?? tCommon("serverAnswered", { status });
  const [open, setOpen] = useState(false);
  const blank = { name: "", type: "expense" as CategoryRow["type"], color: "#64748b" };
  const [values, setValues] = useState(category ?? blank);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    try {
      await request(category ? `/api/categories/${category.id}` : "/api/categories", fail, {
        method: category ? "PATCH" : "POST",
        body: JSON.stringify(
          category
            ? { name: values.name, color: values.color }
            : { name: values.name, type: values.type, color: values.color },
        ),
      });
      toastSuccess(category ? t("saved") : t("added"));
      setOpen(false);
      router.refresh();
    } catch (error) {
      if (error instanceof CategoryError && error.fields) setErrors(api.fields(error.fields));
      else toastError(error, t("saveFailed"));
    } finally {
      setPending(false);
    }
  }

  const prefix = `category-${category?.id ?? "new"}`;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          setValues(category ?? blank);
          setErrors({});
        }
        setOpen(next);
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {category ? t("editTitle", { name: category.name }) : t("addTitle")}
            </DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-3">
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor={`${prefix}-name`}>{t("name")}</FieldLabel>
              <Input
                id={`${prefix}-name`}
                autoFocus
                maxLength={60}
                aria-invalid={errors.name ? true : undefined}
                value={values.name}
                onChange={(event) => setValues((v) => ({ ...v, name: event.target.value }))}
              />
              <FieldError
                errors={errors.name?.map((message) => ({
                  message: tForms("fieldError", { label: t("name"), message }),
                }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${prefix}-type`}>{t("type")}</FieldLabel>
              <NativeSelect
                id={`${prefix}-type`}
                className="w-full"
                value={values.type}
                // Transactions follow their category's type, so it never changes.
                disabled={Boolean(category)}
                onChange={(event) =>
                  setValues((v) => ({ ...v, type: event.target.value as CategoryRow["type"] }))
                }
              >
                <NativeSelectOption value="expense">{t("expense")}</NativeSelectOption>
                <NativeSelectOption value="income">{t("income")}</NativeSelectOption>
              </NativeSelect>
              {category ? <FieldDescription>{t("typeFixed")}</FieldDescription> : null}
            </Field>
            <Field data-invalid={errors.color ? true : undefined}>
              <FieldLabel htmlFor={`${prefix}-color`}>{t("colour")}</FieldLabel>
              <Input
                id={`${prefix}-color`}
                type="color"
                className="h-9 w-16 cursor-pointer p-1"
                value={values.color}
                onChange={(event) => setValues((v) => ({ ...v, color: event.target.value }))}
              />
              <FieldError
                errors={errors.color?.map((message) => ({
                  message: tForms("fieldError", { label: t("colour"), message }),
                }))}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? tCommon("saving") : category ? tCommon("save") : t("add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Hides a category from new transactions, or offers it again. */
export function HideToggle({ category }: { category: CategoryRow }) {
  const router = useRouter();
  const t = useTranslations("finance.categoryDialogs");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const fail = (body: unknown, status: number) =>
    api.message(body) ?? tCommon("serverAnswered", { status });
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      aria-busy={pending}
      onClick={async () => {
        setPending(true);
        try {
          await request(`/api/categories/${category.id}`, fail, {
            method: "PATCH",
            body: JSON.stringify({ hidden: !category.hidden }),
          });
          toastSuccess(t(category.hidden ? "shown" : "hiddenToast", { name: category.name }));
          router.refresh();
        } catch (error) {
          toastError(error, t("changeFailed"));
        } finally {
          setPending(false);
        }
      }}
    >
      {category.hidden ? t("show") : t("hide")}
    </Button>
  );
}

/**
 * Deletes a user category. If transactions use it, offers to move them to
 * another category of the same type first, then deletes it.
 */
export function DeleteCategory({
  category,
  targets,
}: {
  category: CategoryRow;
  /** Visible categories of the same type, to move transactions to. */
  targets: CategoryRow[];
}) {
  const router = useRouter();
  const t = useTranslations("finance.categoryDialogs");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const fail = (body: unknown, status: number) =>
    api.message(body) ?? tCommon("serverAnswered", { status });
  const [moving, setMoving] = useState(false);
  const [systemRefusal, setSystemRefusal] = useState(false);
  const [to, setTo] = useState(targets[0]?.id ?? "");

  async function remove() {
    try {
      await request(`/api/categories/${category.id}`, fail, { method: "DELETE" });
    } catch (error) {
      if (error instanceof CategoryError && error.reason === "in_use") {
        setMoving(true);
        return;
      }
      if (error instanceof CategoryError && error.reason === "system") {
        setSystemRefusal(true);
        return;
      }
      throw error;
    }
    toastSuccess(t("deleted", { name: category.name }));
    router.refresh();
  }

  async function hide() {
    await request(`/api/categories/${category.id}`, fail, {
      method: "PATCH",
      body: JSON.stringify({ hidden: true }),
    });
    toastSuccess(t("hiddenToast", { name: category.name }));
    router.refresh();
  }

  return (
    <>
      <ConfirmDialog
        open={systemRefusal}
        onOpenChange={setSystemRefusal}
        title={t("systemTitle", { name: category.name })}
        description={t("systemDescription")}
        confirmLabel={t("hideInstead")}
        cancelLabel={tCommon("cancel")}
        onConfirm={hide}
      />
      <ConfirmDialog
        trigger={
          <Button variant="destructive" size="sm">
            {tCommon("delete")}
          </Button>
        }
        title={t("deleteTitle", { name: category.name })}
        description={t("deleteDescription")}
        confirmLabel={tCommon("delete")}
        cancelLabel={t("keep")}
        destructive
        onConfirm={remove}
      />
      <ConfirmDialog
        open={moving}
        onOpenChange={setMoving}
        title={t("inUseTitle", { name: category.name })}
        description={
          targets.length > 0 ? (
            <span className="grid gap-2">
              <span>{category.type === "income" ? t("moveIncome") : t("moveExpense")}</span>
              <NativeSelect
                aria-label={t("moveTo")}
                className="w-full"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              >
                {targets.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </span>
          ) : (
            t("noTarget")
          )
        }
        confirmLabel={targets.length > 0 ? t("moveAndDelete") : t("hideInstead")}
        cancelLabel={tCommon("cancel")}
        destructive={targets.length > 0}
        onConfirm={async () => {
          if (targets.length === 0) return hide();
          const { moved } = await reassign(category.id, to, fail);
          await request(`/api/categories/${category.id}`, fail, { method: "DELETE" });
          const target = targets.find((c) => c.id === to)?.name ?? t("otherCategory");
          toastSuccess(t("deleted", { name: category.name }), t("moved", { count: moved, target }));
          router.refresh();
        }}
      />
    </>
  );
}
