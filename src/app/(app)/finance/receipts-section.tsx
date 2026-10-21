"use client";

import { FileText, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toastError } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { MAX_RECEIPTS, MAX_RULE_DOCUMENTS } from "@/lib/finance/receipt-files";
import type { ReceiptDto } from "@/lib/finance/receipts";

import { ReceiptPicker, useUploadReceipt } from "./receipt-picker";

/**
 * The receipts of a saved transaction (GitLab #82), or the documents of a
 * recurring cost (GitLab #130): previews, downloads, uploads and removal.
 * PDFs and HEIC photos download; other images open in a new tab.
 */
export function ReceiptsSection(props: { transactionId: string } | { recurringExpenseId: string }) {
  const rule = "recurringExpenseId" in props;
  const base = rule
    ? `/api/recurring-expenses/${props.recurringExpenseId}/attachments`
    : `/api/transactions/${props.transactionId}/attachments`;
  const max = rule ? MAX_RULE_DOCUMENTS : MAX_RECEIPTS;
  const t = useTranslations("finance.receipts");
  const tDocuments = useTranslations("finance.recurring.documents");
  /** The words that differ between a transaction's receipts and a rule's documents. */
  const own = (
    key: "title" | "none" | "hint" | "full" | "removeTitle" | "add",
    values?: Record<string, string | number>,
  ) => (rule ? tDocuments(key, values) : t(key, values));
  const tCommon = useTranslations("common");
  const router = useRouter();
  const id = useId();
  const uploadReceipt = useUploadReceipt();
  const [receipts, setReceipts] = useState<ReceiptDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(
    (signal?: AbortSignal) =>
      fetch(base, { signal })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error())))
        .then((list: unknown) => {
          if (!Array.isArray(list)) throw new Error();
          setReceipts(list as ReceiptDto[]);
          setFailed(false);
        })
        .catch(() => {
          if (!signal?.aborted) setFailed(true);
        }),
    [base],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function upload(files: File[]) {
    setUploading(true);
    try {
      for (const file of files) {
        const failure = await uploadReceipt(base, file);
        if (failure) throw new Error(failure);
      }
    } catch (error) {
      toastError(error, t("uploadFailed"));
    } finally {
      setUploading(false);
      await load();
      // The ledger shows which transactions have receipts.
      router.refresh();
    }
  }

  const full = receipts !== null && receipts.length >= max;
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-2 border-t pt-4">
      <h3 id={`${id}-title`} className="text-sm font-medium">
        {own("title")}
      </h3>
      {failed ? (
        <p role="alert" className="text-destructive text-sm">
          {t("loadFailed")}
        </p>
      ) : receipts === null ? (
        <p className="text-muted-foreground text-sm">{t("loading")}</p>
      ) : receipts.length === 0 ? (
        <p className="text-muted-foreground text-sm">{own("none")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {receipts.map((receipt) => (
            <li key={receipt.id} className="relative rounded-lg border p-1 text-xs">
              <a
                href={`/api/attachments/${receipt.id}`}
                target="_blank"
                rel="noreferrer"
                className="block"
                aria-label={t("open", { name: receipt.fileName })}
              >
                {receipt.hasThumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a private, signed-in file
                  <img
                    src={`/api/attachments/${receipt.id}/thumbnail`}
                    alt=""
                    className="bg-muted aspect-[4/3] w-full rounded object-cover"
                  />
                ) : (
                  <span className="bg-muted flex aspect-[4/3] w-full items-center justify-center rounded">
                    <FileText aria-hidden className="text-muted-foreground size-8" />
                  </span>
                )}
                <span className="mt-1 block truncate">{receipt.fileName}</span>
              </a>
              <ConfirmDialog
                trigger={
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute top-1 right-1 size-7 bg-background/80"
                    aria-label={t("remove", { name: receipt.fileName })}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                }
                title={own("removeTitle", { name: receipt.fileName })}
                description={t("removeDescription")}
                confirmLabel={tCommon("delete")}
                destructive
                onConfirm={async () => {
                  const response = await fetch(`/api/attachments/${receipt.id}`, {
                    method: "DELETE",
                  });
                  if (!response.ok) {
                    throw new Error(tCommon("serverAnswered", { status: response.status }));
                  }
                  await load();
                  router.refresh();
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <ReceiptPicker
        onFiles={(files) => void upload(files)}
        disabled={uploading || full || receipts === null}
        busy={uploading}
        label={own("add")}
        hint={full ? own("full", { max }) : own("hint", { max })}
      />
    </section>
  );
}
