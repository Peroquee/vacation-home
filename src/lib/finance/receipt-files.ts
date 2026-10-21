/**
 * Reading receipt files (GitLab #82): what a file is, by its own bytes, and
 * a JPEG without its metadata. Pure and dependency-free, so it runs in the
 * route and in tests alike.
 */

export const RECEIPT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;
export type ReceiptType = (typeof RECEIPT_TYPES)[number];

/** At most this many bytes per file. */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
/** At most this many receipts per transaction. */
export const MAX_RECEIPTS = 5;
/** A recurring cost's documents (GitLab #130): its contract and years of statements. */
export const MAX_RULE_DOCUMENTS = 20;
/** A thumbnail is a small JPEG made in the browser. */
export const MAX_THUMBNAIL_BYTES = 200 * 1024;

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

/**
 * The type a file really is, from its first bytes; null for anything else.
 * The name and the browser's claim are never trusted.
 */
export function sniffType(bytes: Uint8Array): ReceiptType | null {
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) {
    return "image/png";
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  // ISO base media: a `ftyp` box naming a HEIF brand (iPhone photos).
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) {
      return "image/heic";
    }
  }
  return null;
}

/**
 * A JPEG without its metadata segments: APP1 (EXIF, which holds the GPS
 * position, and XMP), APP13 (IPTC) and comments. Everything that draws the
 * picture stays, byte for byte. Returns null for a malformed JPEG.
 *
 * A JPEG is a sequence of segments: FF xx, then a two-byte length that counts
 * itself. From start-of-scan (FF DA) on, the rest is image data and is copied
 * unchanged.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    // Fill bytes before a marker.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xda) {
      kept.push(bytes.subarray(offset));
      return concat(kept);
    }
    // Markers without a length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    const segment = bytes.subarray(offset, offset + 2 + length);
    const metadata = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!metadata) kept.push(segment);
    offset += 2 + length;
  }
  return null;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A file name safe to store and to put in a header: no paths, no control characters. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";

  const clean = base
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .trim()
    .slice(0, 200);
  return clean || "receipt";
}
