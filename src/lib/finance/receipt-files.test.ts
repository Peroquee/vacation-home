import { describe, expect, it } from "vitest";

import { cleanFileName, sniffType, stripJpegMetadata } from "./receipt-files";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );
/** A segment: marker, length (counting itself), payload. */
const segment = (marker: number, payload: number[] | string) => {
  const body = typeof payload === "string" ? [...payload].map((c) => c.charCodeAt(0)) : payload;
  return [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
};

describe("sniffType", () => {
  it("knows each accepted type by its bytes", () => {
    expect(sniffType(bytes("%PDF-1.7\n"))).toBe("application/pdf");
    expect(sniffType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffType(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toBe("image/webp");
    expect(sniffType(bytes([0, 0, 0, 24], "ftypheic", [0, 0, 0, 0]))).toBe("image/heic");
  });

  it("refuses anything else, whatever its name says", () => {
    expect(sniffType(bytes("<html><script>"))).toBeNull();
    expect(sniffType(bytes("GIF89a"))).toBeNull();
    expect(sniffType(bytes([0, 0, 0, 24], "ftypmp42"))).toBeNull();
    expect(sniffType(new Uint8Array())).toBeNull();
  });
});

describe("stripJpegMetadata", () => {
  const app0 = segment(0xe0, "JFIF\0\x01\x01\0\0\x01\0\x01\0\0");
  const exif = segment(0xe1, "Exif\0\0GPS 52.52N 13.40E");
  const comment = segment(0xfe, "taken at home");
  const quant = segment(0xdb, [0, ...Array(64).fill(1)]);
  const scan = [0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0xff, 0xd9];
  const jpeg = bytes([0xff, 0xd8], app0, exif, comment, quant, scan);

  it("drops EXIF, IPTC and comments, and keeps the picture byte for byte", () => {
    const stripped = stripJpegMetadata(jpeg)!;
    expect(stripped).toEqual(bytes([0xff, 0xd8], app0, quant, scan));
    expect(new TextDecoder().decode(stripped)).not.toContain("GPS");
  });

  it("leaves a JPEG without metadata as it is", () => {
    const plain = bytes([0xff, 0xd8], app0, quant, scan);
    expect(stripJpegMetadata(plain)).toEqual(plain);
  });

  it("refuses a malformed file rather than guessing", () => {
    expect(stripJpegMetadata(bytes("%PDF-"))).toBeNull();
    expect(stripJpegMetadata(bytes([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toBeNull();
    expect(stripJpegMetadata(bytes([0xff, 0xd8], app0))).toBeNull();
  });
});

describe("cleanFileName", () => {
  it("keeps the name without paths or control characters", () => {
    expect(cleanFileName("C:\\Users\\me\\Rechnung März.pdf")).toBe("Rechnung März.pdf");
    expect(cleanFileName('../../etc/"passwd"\n')).toBe("passwd");
    expect(cleanFileName("   ")).toBe("receipt");
  });
});
