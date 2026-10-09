"use client";

import { FileText, Paperclip, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toastError } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { useApiText } from "@/i18n/use-api-text";
import { MAX_RECEIPTS } from "@/lib/finance/receipt-files";
import type { ReceiptDto } from "@/lib/finance/receipts";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic,.heic";
/** Longest side of a thumbnail, in pixels. */
const THUMBNAIL_SIZE = 320;

/**
 * A small JPEG preview of an image, made here so the server needs no image
 * library; drawing it on a canvas also leaves its metadata behind. Null when
 * the browser cannot draw the file (HEIC outside Safari, a PDF).
 */
async function thumbnailOf(file: File): Promise<Blob | null> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap !== "function") {
    return null;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  } catch {
    return null;
  }
}

/**
 * The receipts of a saved transaction (GitLab #82): previews, downloads,
 * uploads and removal. PDFs and HEIC photos download; other images open in
 * a new tab.
 */
export function ReceiptsSection({ transactionId }: { transactionId: string }) {
  const t = useTranslations("finance.receipts");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const router = useRouter();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [receipts, setReceipts] = useState<ReceiptDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(
    (signal?: AbortSignal) =>
      fetch(`/api/transactions/${transactionId}/attachments`, { signal })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error())))
        .then((list: unknown) => {
          if (!Array.isArray(list)) throw new Error();
          setReceipts(list as ReceiptDto[]);
          setFailed(false);
        })
        .catch(() => {
          if (!signal?.aborted) setFailed(true);
        }),
    [transactionId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function upload(files: FileList) {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("file", file);
        const thumbnail = await thumbnailOf(file);
        if (thumbnail) form.set("thumbnail", thumbnail, "thumbnail.jpg");
        const response = await fetch(`/api/transactions/${transactionId}/attachments`, {
          method: "POST",
          body: form,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          const field = body?.error?.fields?.file?.[0] ?? body?.error?.fields?.thumbnail?.[0];
          throw new Error(
            field
              ? `${file.name}: ${api.text(field)}`
              : (api.message(body) ?? tCommon("serverAnswered", { status: response.status })),
          );
        }
      }
    } catch (error) {
      toastError(error, t("uploadFailed"));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
      await load();
      // The ledger shows which transactions have receipts.
      router.refresh();
    }
  }

  const full = receipts !== null && receipts.length >= MAX_RECEIPTS;
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-2 border-t pt-4">
      <h3 id={`${id}-title`} className="text-sm font-medium">
        {t("title")}
      </h3>
      {failed ? (
        <p role="alert" className="text-destructive text-sm">
          {t("loadFailed")}
        </p>
      ) : receipts === null ? (
        <p className="text-muted-foreground text-sm">{t("loading")}</p>
      ) : receipts.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("none")}</p>
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
                title={t("removeTitle", { name: receipt.fileName })}
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
      <input
        ref={input}
        id={`${id}-file`}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        disabled={uploading || full}
        onChange={(event) => {
          if (event.target.files?.length) void upload(event.target.files);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={uploading || full || receipts === null}
          aria-busy={uploading}
          onClick={() => input.current?.click()}
        >
          <Paperclip data-icon="inline-start" aria-hidden />
          {uploading ? t("uploading") : t("add")}
        </Button>
        <p className="text-muted-foreground text-xs">
          {full ? t("full", { max: MAX_RECEIPTS }) : t("hint", { max: MAX_RECEIPTS })}
        </p>
      </div>
    </section>
  );
}
