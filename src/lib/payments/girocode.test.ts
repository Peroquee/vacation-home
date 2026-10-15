import jsQR from "jsqr";
import QRCode from "qrcode";
import { describe, expect, it } from "vitest";

import { epcPayload, girocodeSvg, remittanceFor } from "./girocode";

const DETAILS = {
  accountHolder: "Ada Lovelace",
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
  amountMinor: 35_000,
  currency: "EUR",
  remittance: remittanceFor("K7QD9MXA"),
};

/** What a scanner reads from the QR code: drawn module by module, then decoded. */
function scan(payload: string): string | null {
  const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
  const scale = 4;
  const quiet = 4;
  const size = (qr.modules.size + 2 * quiet) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let row = 0; row < qr.modules.size; row++) {
    for (let col = 0; col < qr.modules.size; col++) {
      if (!qr.modules.get(row, col)) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const at = (((row + quiet) * scale + y) * size + (col + quiet) * scale + x) * 4;
          pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
        }
      }
    }
  }
  return jsQR(pixels, size, size)?.data ?? null;
}

describe("the GiroCode (EPC069-12)", () => {
  it("holds the transfer in the standard's lines", () => {
    expect(epcPayload(DETAILS)?.split("\n")).toEqual([
      "BCD",
      "002",
      "1",
      "SCT",
      "COBADEFFXXX",
      "Ada Lovelace",
      "DE89370400440532013000",
      "EUR350.00",
      "",
      "",
      "Booking K7QD-9MXA",
    ]);
  });

  it("scans back to exactly that, also without a BIC and with umlauts", async () => {
    const payload = epcPayload({
      ...DETAILS,
      bic: null,
      accountHolder: "Jürgen Müller",
      amountMinor: 1_205,
    })!;
    expect(payload).toContain("\n\nJürgen Müller\n");
    expect(payload).toContain("EUR12.05");
    expect(scan(payload)).toBe(payload);
    expect(await girocodeSvg(payload)).toMatch(/^<svg/);
  });

  it("stays within the standard's limits", () => {
    const long = epcPayload({
      ...DETAILS,
      accountHolder: "A".repeat(100),
      remittance: "R".repeat(200),
    })!;
    const lines = long.split("\n");
    expect(lines[5]).toHaveLength(70);
    expect(lines[10]).toHaveLength(140);
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(331);
  });

  it("is euros only, from one cent", () => {
    expect(epcPayload({ ...DETAILS, currency: "CHF" })).toBeNull();
    expect(epcPayload({ ...DETAILS, amountMinor: 0 })).toBeNull();
    expect(epcPayload({ ...DETAILS, amountMinor: 1 })).toContain("EUR0.01");
  });
});
