"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { CalendarBlock } from "@/lib/availability/calendar";
import { useFormat } from "@/i18n/use-format";
import { useApiText } from "@/i18n/use-api-text";

type FieldErrors = Record<string, string[] | undefined>;

export type EditableBlock = CalendarBlock & { propertyId: string };

/** The API's error, as a thrown value the dialog can show. */
export class BlockRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields?: FieldErrors,
  ) {
    super(message);
  }
}

export async function blockRequest(
  url: string,
  fail: (body: unknown, status: number) => string,
  init: RequestInit,
): Promise<unknown> {
  const response = await fetch(url, init);
  if (response.status === 204) return null;
  const body = await response.json().catch(() => null);
  if (response.ok) return body;
  throw new BlockRequestError(fail(body, response.status), response.status, body?.error?.fields);
}

/**
 * Edits or deletes an owner block. A block imported from Google Calendar is
 * shown read-only: only the sync changes it, so the dialog says where to
 * change it instead.
 */
export function BlockDialog({
  block,
  onClose,
  onChanged,
}: {
  block: EditableBlock | null;
  onClose: () => void;
  /** After a successful save or delete, to reload the calendar. */
  onChanged: () => void;
}) {
  return (
    <Dialog open={block !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        {block ? (
          <BlockDialogBody key={block.id} block={block} onClose={onClose} onChanged={onChanged} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BlockDialogBody({
  block,
  onClose,
  onChanged,
}: {
  block: EditableBlock;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [values, setValues] = useState({
    startDate: block.startDate,
    endDate: block.endDate,
    reason: block.reason ?? "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const t = useTranslations("calendar.block");
  const tForms = useTranslations("forms");
  const tCommon = useTranslations("common");
  const format = useFormat();
  const api = useApiText();
  const fail = (body: unknown, status: number) =>
    api.message(body) ?? tCommon("serverAnswered", { status });

  if (block.origin === "google") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t("googleTitle")}</DialogTitle>
          <DialogDescription>
            {format.dateRange(block.startDate, block.endDate)}
            {block.reason ? `: ${block.reason}` : ""}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">{t("googleHint")}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tCommon("close")}
          </Button>
        </DialogFooter>
      </>
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFailure(null);
    try {
      await blockRequest(`/api/blocks/${block.id}`, fail, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      toastSuccess(t("saved"));
      onChanged();
      onClose();
    } catch (error) {
      if (error instanceof BlockRequestError && error.fields) setErrors(api.fields(error.fields));
      else setFailure(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      setPending(false);
    }
  }

  const fields = [
    { key: "startDate", label: t("firstNight"), type: "date" },
    { key: "endDate", label: t("freeAgain"), type: "date" },
    { key: "reason", label: t("reason"), type: "text" },
  ] as const;

  return (
    <form onSubmit={save} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-3">
        {fields.map(({ key, label, type }) => {
          const messages = errors[key];
          const id = `block-${block.id}-${key}`;
          return (
            <Field key={key} data-invalid={messages ? true : undefined}>
              <FieldLabel htmlFor={id}>{label}</FieldLabel>
              <Input
                id={id}
                type={type}
                maxLength={type === "text" ? 200 : undefined}
                aria-invalid={messages ? true : undefined}
                value={values[key]}
                onChange={(event) => setValues((v) => ({ ...v, [key]: event.target.value }))}
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
      </FieldGroup>
      <DialogFooter className="sm:justify-between">
        <ConfirmDialog
          trigger={
            <Button type="button" variant="destructive" disabled={pending}>
              {t("delete")}
            </Button>
          }
          title={t("deleteTitle")}
          description={t("deleteDescription")}
          confirmLabel={t("delete")}
          cancelLabel={t("keep")}
          destructive
          onConfirm={async () => {
            // A failure stays in the dialog as a toast (ConfirmDialog does that).
            await blockRequest(`/api/blocks/${block.id}`, fail, { method: "DELETE" });
            toastSuccess(t("deleted"));
            onChanged();
            onClose();
          }}
        />
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? tCommon("saving") : tCommon("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
