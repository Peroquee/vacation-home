/**
 * Turning an uploaded photo into what the public page serves (GitLab #106).
 * Server-side only.
 *
 * The type comes from the file's own bytes: JPEG, PNG or WebP. The picture
 * is turned upright (EXIF orientation), then re-encoded as WebP in a few
 * widths for responsive images. The upload itself is never stored, and sharp
 * writes no metadata unless asked, so no EXIF, GPS position, XMP or ICC
 * profile from the camera survives, whatever the format. HEIC (the iPhone
 * default) is refused: the file picker asks iOS for JPEG, which it converts
 * to by itself, so only an unusual upload gets here with one.
 */
import sharp from "sharp";

import { sniffType } from "@/lib/finance/receipt-files";

/** Largest upload accepted: a phone's full-size photo fits easily. */
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
/** Decoding stops beyond this many pixels: a small file can claim a huge picture. */
export const MAX_PHOTO_PIXELS = 50_000_000;
/** The widths stored, for `srcset`; smaller pictures are never enlarged. */
export const PHOTO_WIDTHS = [480, 960, 1600] as const;

export type ProcessedSize = { width: number; height: number; bytes: Buffer };

export type ProcessedPhoto =
  { sizes: ProcessedSize[] } | { error: "empty" | "too_large" | "heic" | "type" | "unreadable" };

export async function processPhoto(bytes: Uint8Array): Promise<ProcessedPhoto> {
  if (bytes.length === 0) return { error: "empty" };
  if (bytes.length > MAX_PHOTO_BYTES) return { error: "too_large" };
  const type = sniffType(bytes);
  if (type === "image/heic") return { error: "heic" };
  if (type !== "image/jpeg" && type !== "image/png" && type !== "image/webp") {
    return { error: "type" };
  }

  try {
    const upright = sharp(bytes, { limitInputPixels: MAX_PHOTO_PIXELS, failOn: "error" }).rotate();
    const { width = 0 } = await upright.clone().metadata();
    // The widths up to the picture's own, plus its own if it is narrower
    // than the largest: never upscaled, never two copies of one size.
    const targets = [...new Set(PHOTO_WIDTHS.map((w) => Math.min(w, width)))].filter((w) => w > 0);
    const sizes: ProcessedSize[] = [];
    for (const target of targets) {
      const { data, info } = await upright
        .clone()
        .resize({ width: target, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
      sizes.push({ width: info.width, height: info.height, bytes: data });
    }
    if (sizes.length === 0) return { error: "unreadable" };
    return { sizes };
  } catch {
    return { error: "unreadable" };
  }
}

/** The API's message for each refusal (src/i18n/api-text.ts translates them). */
export const PHOTO_ERRORS: Record<Exclude<ProcessedPhoto, { sizes: unknown }>["error"], string> = {
  empty: "is required",
  too_large: "is larger than 20 MB",
  heic: "is a HEIC photo: choose JPEG in the upload, or save it as JPEG first",
  type: "must be a JPEG, PNG or WebP image",
  unreadable: "is not a readable image",
};
