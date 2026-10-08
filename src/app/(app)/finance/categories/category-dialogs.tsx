"use client";

import { useRouter } from "next/navigation";
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

async function request(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => null);
  if (response.ok) return body;
  throw new CategoryError(
    body?.error?.message ?? `The server answered ${response.status}.`,
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
export async function reassign(fromId: string, toId: string): Promise<{ moved: number }> {
  return (await request(`/api/categories/${fromId}/reassign`, {
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
      await request(category ? `/api/categories/${category.id}` : "/api/categories", {
        method: category ? "PATCH" : "POST",
        body: JSON.stringify(
          category
            ? { name: values.name, color: values.color }
            : { name: values.name, type: values.type, color: values.color },
        ),
      });
      toastSuccess(category ? "Category saved" : "Category added");
      setOpen(false);
      router.refresh();
    } catch (error) {
      if (error instanceof CategoryError && error.fields) setErrors(error.fields);
      else toastError(error, "Could not save the category");
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
            <DialogTitle>{category ? `Edit ${category.name}` : "Add a category"}</DialogTitle>
            <DialogDescription>
              The colour is the one the expense breakdown chart uses.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-3">
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor={`${prefix}-name`}>Name</FieldLabel>
              <Input
                id={`${prefix}-name`}
                autoFocus
                maxLength={60}
                aria-invalid={errors.name ? true : undefined}
                value={values.name}
                onChange={(event) => setValues((v) => ({ ...v, name: event.target.value }))}
              />
              <FieldError
                errors={errors.name?.map((message) => ({ message: `Name ${message}` }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${prefix}-type`}>Type</FieldLabel>
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
                <NativeSelectOption value="expense">Expense</NativeSelectOption>
                <NativeSelectOption value="income">Income</NativeSelectOption>
              </NativeSelect>
              {category ? <FieldDescription>The type cannot change.</FieldDescription> : null}
            </Field>
            <Field data-invalid={errors.color ? true : undefined}>
              <FieldLabel htmlFor={`${prefix}-color`}>Colour</FieldLabel>
              <Input
                id={`${prefix}-color`}
                type="color"
                className="h-9 w-16 cursor-pointer p-1"
                value={values.color}
                onChange={(event) => setValues((v) => ({ ...v, color: event.target.value }))}
              />
              <FieldError
                errors={errors.color?.map((message) => ({ message: `Colour ${message}` }))}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? "Saving…" : category ? "Save" : "Add category"}
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
          await request(`/api/categories/${category.id}`, {
            method: "PATCH",
            body: JSON.stringify({ hidden: !category.hidden }),
          });
          toastSuccess(category.hidden ? `${category.name} shown` : `${category.name} hidden`);
          router.refresh();
        } catch (error) {
          toastError(error, "Could not change the category");
        } finally {
          setPending(false);
        }
      }}
    >
      {category.hidden ? "Show" : "Hide"}
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
  const [moving, setMoving] = useState(false);
  const [systemRefusal, setSystemRefusal] = useState(false);
  const [to, setTo] = useState(targets[0]?.id ?? "");

  async function remove() {
    try {
      await request(`/api/categories/${category.id}`, { method: "DELETE" });
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
    toastSuccess(`${category.name} deleted`);
    router.refresh();
  }

  async function hide() {
    await request(`/api/categories/${category.id}`, {
      method: "PATCH",
      body: JSON.stringify({ hidden: true }),
    });
    toastSuccess(`${category.name} hidden`);
    router.refresh();
  }

  return (
    <>
      <ConfirmDialog
        open={systemRefusal}
        onOpenChange={setSystemRefusal}
        title={`${category.name} is a default category`}
        description="Default categories cannot be deleted. Hide it instead: it stops being offered for new transactions, and existing ones keep it."
        confirmLabel="Hide instead"
        cancelLabel="Cancel"
        onConfirm={hide}
      />
      <ConfirmDialog
        trigger={
          <Button variant="destructive" size="sm">
            Delete
          </Button>
        }
        title={`Delete ${category.name}?`}
        description="If transactions use it, you can move them to another category first."
        confirmLabel="Delete"
        cancelLabel="Keep it"
        destructive
        onConfirm={remove}
      />
      <ConfirmDialog
        open={moving}
        onOpenChange={setMoving}
        title={`${category.name} is in use`}
        description={
          targets.length > 0 ? (
            <span className="grid gap-2">
              <span>
                Transactions use this category. Move them to another{" "}
                {category.type === "income" ? "income" : "expense"} category, then delete it.
              </span>
              <NativeSelect
                aria-label="Move transactions to"
                className="w-full"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              >
                {targets.map((t) => (
                  <NativeSelectOption key={t.id} value={t.id}>
                    {t.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </span>
          ) : (
            "Transactions use this category, and there is no other category of its type to move them to. Hide it instead."
          )
        }
        confirmLabel={targets.length > 0 ? "Move and delete" : "Hide instead"}
        cancelLabel="Cancel"
        destructive={targets.length > 0}
        onConfirm={async () => {
          if (targets.length === 0) return hide();
          const { moved } = await reassign(category.id, to);
          await request(`/api/categories/${category.id}`, { method: "DELETE" });
          const target = targets.find((t) => t.id === to)?.name ?? "the other category";
          toastSuccess(
            `${category.name} deleted`,
            `${moved} ${moved === 1 ? "transaction" : "transactions"} moved to ${target}.`,
          );
          router.refresh();
        }}
      />
    </>
  );
}
