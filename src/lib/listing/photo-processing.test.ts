import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { PHOTO_ERRORS, processPhoto } from "./photo-processing";

const picture = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 200 } } });

describe("processPhoto", () => {
  it("stores WebP sizes for srcset, never enlarging the picture", async () => {
    const result = await processPhoto(await picture(2000, 1000).jpeg().toBuffer());
    if (!("sizes" in result)) throw new Error(result.error);
    expect(result.sizes.map(({ width, height }) => [width, height])).toEqual([
      [480, 240],
      [960, 480],
      [1600, 800],
    ]);
    for (const size of result.sizes) {
      expect((await sharp(size.bytes).metadata()).format).toBe("webp");
    }

    const small = await processPhoto(await picture(700, 500).png().toBuffer());
    if (!("sizes" in small)) throw new Error(small.error);
    expect(small.sizes.map((s) => s.width)).toEqual([480, 700]);
  });

  it("keeps no metadata from the camera: no EXIF, GPS or text", async () => {
    const upload = await picture(800, 600)
      .jpeg()
      .withExif({
        IFD0: { ImageDescription: "Secret place", Make: "PhoneCo" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 8/1 0/1" },
      })
      .toBuffer();
    expect((await sharp(upload).metadata()).exif).toBeDefined();

    const result = await processPhoto(upload);
    if (!("sizes" in result)) throw new Error(result.error);
    for (const { bytes } of result.sizes) {
      const metadata = await sharp(bytes).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(bytes.includes("Secret place")).toBe(false);
      expect(bytes.includes("PhoneCo")).toBe(false);
    }
  });

  it("turns a photo upright by its EXIF orientation", async () => {
    // Stored landscape, shown rotated 90° (orientation 6): portrait.
    const upload = await picture(600, 300).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await processPhoto(upload);
    if (!("sizes" in result)) throw new Error(result.error);
    expect(result.sizes.at(-1)).toMatchObject({ width: 300, height: 600 });
  });

  it("refuses what is not a JPEG, PNG or WebP picture, by its bytes", async () => {
    expect(await processPhoto(new Uint8Array())).toEqual({ error: "empty" });
    expect(await processPhoto(Buffer.from("%PDF-1.7 not a photo"))).toEqual({ error: "type" });
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypheic"),
      Buffer.alloc(16),
    ]);
    expect(await processPhoto(heic)).toEqual({ error: "heic" });
    // JPEG's magic bytes, then nonsense.
    expect(await processPhoto(Buffer.from([0xff, 0xd8, 0xff, 0x00, 1, 2, 3]))).toEqual({
      error: "unreadable",
    });
    expect(PHOTO_ERRORS.heic).toMatch(/JPEG/);
  });

  it("refuses a picture claiming too many pixels", async () => {
    const huge = await sharp({
      create: { width: 10_000, height: 6_000, channels: 3, background: "#fff" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(await processPhoto(huge)).toEqual({ error: "unreadable" });
  });
});
