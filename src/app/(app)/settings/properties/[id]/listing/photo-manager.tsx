"use client";

import { ArrowLeft, ArrowRight, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useApiText } from "@/i18n/use-api-text";
import type { PhotoDto } from "@/lib/listing/service";
import { LISTING_LIMITS, MAX_PHOTOS } from "@/lib/listing/values";

/**
 * Exactly these types, not `image/*`: iOS then converts HEIC photos to JPEG
 * as it uploads them, so an iPhone or iPad photo just works.
 */
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";

/** The listing's photos: upload, order (the first is the cover), describe, remove. */
export function PhotoManager({ propertyId, initial }: { propertyId: string; initial: PhotoDto[] }) {
  const t = useTranslations("listing.photos");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const [photos, setPhotos] = useState(initial);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const base = `/api/properties/${propertyId}/photos`;

  async function failure(response: Response): Promise<Error> {
    const body = await response.json().catch(() => null);
    const field = body?.error?.fields?.file?.[0];
    return new Error(
      typeof field === "string"
        ? api.text(field)
        : (api.message(body) ?? tCommon("serverAnswered", { status: response.status })),
    );
  }

  async function upload(files: File[]) {
    setError(null);
    setUploading({ done: 0, total: files.length });
    const problems: string[] = [];
    // One at a time: each is decoded and re-encoded on the server.
    for (const [index, file] of files.entries()) {
      const form = new FormData();
      form.set("file", file);
      try {
        const response = await fetch(base, { method: "POST", body: form });
        if (!response.ok) throw await failure(response);
        const photo: PhotoDto = await response.json();
        setPhotos((current) => [...current, photo]);
      } catch (cause) {
        problems.push(t("uploadFailed", { name: file.name, reason: (cause as Error).message }));
      }
      setUploading({ done: index + 1, total: files.length });
    }
    setUploading(null);
    if (input.current) input.current.value = "";
    if (problems.length > 0) setError(problems.join(" "));
    else toastSuccess(t("uploaded", { count: files.length }));
  }

  async function reorder(next: PhotoDto[]) {
    const previous = photos;
    setPhotos(next);
    try {
      const response = await fetch(`${base}/order`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: next.map((p) => p.id) }),
      });
      if (!response.ok) throw await failure(response);
      setPhotos(await response.json());
    } catch (cause) {
      setPhotos(previous);
      toastError(cause, t("reorderFailed"));
    }
  }

  function move(index: number, to: number) {
    const next = [...photos];
    const [photo] = next.splice(index, 1);
    next.splice(to, 0, photo!);
    void reorder(next);
  }

  async function remove(photo: PhotoDto) {
    const response = await fetch(`${base}/${photo.id}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) throw await failure(response);
    setPhotos((current) => current.filter((p) => p.id !== photo.id));
    toastSuccess(t("deleted"));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("heading")}</CardTitle>
        <CardDescription>{t("hint", { max: MAX_PHOTOS })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={input}
            id="listing-photo-upload"
            type="file"
            accept={PHOTO_ACCEPT}
            multiple
            className="sr-only"
            disabled={uploading !== null || photos.length >= MAX_PHOTOS}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              if (files.length > 0) void upload(files.slice(0, MAX_PHOTOS - photos.length));
            }}
          />
          <Button
            type="button"
            disabled={uploading !== null || photos.length >= MAX_PHOTOS}
            aria-busy={uploading !== null}
            onClick={() => input.current?.click()}
          >
            {uploading
              ? t("uploading", { done: uploading.done, total: uploading.total })
              : t("add")}
          </Button>
          <span className="text-muted-foreground text-sm">{t("types")}</span>
        </div>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        {photos.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("none")}</p>
        ) : (
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map((photo, index) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                src={`${base}/files/${photo.sizes[0]!.file}`}
                cover={index === 0}
                onEarlier={index > 0 ? () => move(index, index - 1) : null}
                onLater={index < photos.length - 1 ? () => move(index, index + 1) : null}
                onCover={() => move(index, 0)}
                onSaved={(saved) =>
                  setPhotos((current) => current.map((p) => (p.id === saved.id ? saved : p)))
                }
                onRemove={() => remove(photo)}
                base={base}
                failure={failure}
              />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function PhotoCard({
  photo,
  src,
  cover,
  onEarlier,
  onLater,
  onCover,
  onSaved,
  onRemove,
  base,
  failure,
}: {
  photo: PhotoDto;
  src: string;
  cover: boolean;
  onEarlier: (() => void) | null;
  onLater: (() => void) | null;
  onCover: () => void;
  onSaved: (photo: PhotoDto) => void;
  onRemove: () => Promise<void>;
  base: string;
  failure: (response: Response) => Promise<Error>;
}) {
  const t = useTranslations("listing.photos");
  const tCommon = useTranslations("common");
  const [alt, setAlt] = useState({ altEn: photo.altEn, altDe: photo.altDe });
  const [saving, setSaving] = useState(false);
  const changed = alt.altEn !== photo.altEn || alt.altDe !== photo.altDe;
  const size = photo.sizes[0]!;

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(`${base}/${photo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(alt),
      });
      if (!response.ok) throw await failure(response);
      onSaved(await response.json());
      toastSuccess(t("altSaved"));
    } catch (cause) {
      toastError(cause, t("altFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="space-y-2 rounded-lg border p-2">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element -- already resized; served from the file store */}
        <img
          src={src}
          width={size.width}
          height={size.height}
          alt={alt.altEn || alt.altDe}
          className="aspect-[4/3] w-full rounded-md object-cover"
        />
        {cover ? (
          <span className="bg-background/90 absolute top-2 left-2 rounded-md px-2 py-0.5 text-xs font-medium">
            {t("cover")}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!onEarlier}
          aria-label={t("earlier")}
          onClick={() => onEarlier?.()}
        >
          <ArrowLeft aria-hidden />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!onLater}
          aria-label={t("later")}
          onClick={() => onLater?.()}
        >
          <ArrowRight aria-hidden />
        </Button>
        {!cover ? (
          <Button type="button" size="sm" variant="outline" onClick={onCover}>
            <Star data-icon="inline-start" aria-hidden />
            {t("makeCover")}
          </Button>
        ) : null}
        <ConfirmDialog
          trigger={
            <Button type="button" size="sm" variant="outline">
              {tCommon("delete")}
            </Button>
          }
          title={t("deleteTitle")}
          description={t("deleteDescription")}
          confirmLabel={tCommon("delete")}
          destructive
          onConfirm={onRemove}
        />
      </div>
      <label className="block text-xs font-medium" htmlFor={`alt-en-${photo.id}`}>
        {t("altEn")}
      </label>
      <Input
        id={`alt-en-${photo.id}`}
        value={alt.altEn}
        maxLength={LISTING_LIMITS.alt}
        onChange={(event) => setAlt({ ...alt, altEn: event.target.value })}
      />
      <label className="block text-xs font-medium" htmlFor={`alt-de-${photo.id}`}>
        {t("altDe")}
      </label>
      <Input
        id={`alt-de-${photo.id}`}
        value={alt.altDe}
        maxLength={LISTING_LIMITS.alt}
        onChange={(event) => setAlt({ ...alt, altDe: event.target.value })}
      />
      {changed ? (
        <Button type="button" size="sm" disabled={saving} aria-busy={saving} onClick={save}>
          {saving ? tCommon("saving") : t("saveAlt")}
        </Button>
      ) : null}
    </li>
  );
}
