"use client";

import { Camera, Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useApiText } from "@/i18n/use-api-text";
import { cn } from "@/lib/utils";

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
 * Uploads one receipt to `url` (a transaction's attachments, GitLab #82):
 * null when it was added, else why not, in words and naming the file.
 */
export function useUploadReceipt() {
  const t = useTranslations("finance.receipts");
  const tCommon = useTranslations("common");
  const api = useApiText();
  return useCallback(
    async (url: string, file: File): Promise<string | null> => {
      try {
        const form = new FormData();
        form.set("file", file);
        const thumbnail = await thumbnailOf(file);
        if (thumbnail) form.set("thumbnail", thumbnail, "thumbnail.jpg");
        const response = await fetch(url, { method: "POST", body: form });
        if (response.ok) return null;
        const body = await response.json().catch(() => null);
        const field = body?.error?.fields?.file?.[0] ?? body?.error?.fields?.thumbnail?.[0];
        return field
          ? `${file.name}: ${api.text(field)}`
          : `${file.name}: ${api.message(body) ?? tCommon("serverAnswered", { status: response.status })}`;
      } catch {
        return `${file.name}: ${t("connectionFailed")}`;
      }
    },
    [api, t, tCommon],
  );
}

/**
 * Where receipts are chosen: a button for files, one for the camera on
 * phones and tablets, and the area itself takes files dropped on it.
 */
export function ReceiptPicker({
  onFiles,
  disabled,
  busy,
  hint,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  busy?: boolean;
  hint: string;
}) {
  const t = useTranslations("finance.receipts");
  const id = useId();
  const files = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function take(input: HTMLInputElement) {
    if (input.files?.length) onFiles(Array.from(input.files));
    input.value = "";
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2",
        over && "border-primary bg-primary/5",
      )}
      onDragOver={(event) => {
        if (disabled || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        if (disabled) return;
        event.preventDefault();
        if (event.dataTransfer.files.length) onFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <input
        ref={files}
        id={`${id}-file`}
        type="file"
        aria-label={t("add")}
        accept={ACCEPT}
        multiple
        className="sr-only"
        disabled={disabled}
        onChange={(event) => take(event.target)}
      />
      <input
        ref={camera}
        id={`${id}-camera`}
        type="file"
        aria-label={t("camera")}
        accept="image/*"
        capture="environment"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => take(event.target)}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        aria-busy={busy}
        onClick={() => files.current?.click()}
      >
        <Paperclip data-icon="inline-start" aria-hidden />
        {busy ? t("uploading") : t("add")}
      </Button>
      {/* Only where there is a camera to speak of: phones and tablets. */}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="hidden pointer-coarse:inline-flex"
        disabled={disabled}
        onClick={() => camera.current?.click()}
      >
        <Camera data-icon="inline-start" aria-hidden />
        {t("camera")}
      </Button>
      <p className="text-muted-foreground basis-full text-xs">{hint}</p>
    </div>
  );
}
